(function() {
	//"use strict";

	var MAGIC_ARGS_NEW = {}
	var dynamicNew = function(constr,args){
		function F() {
		    return constr.apply(this, args);
		}
		F.prototype = constr.prototype;
		return new F();
	}

	///////////////////////////////////////////////////////////////////////////////////////////////////////////////
	var registration = function(key, container, value, lifecycle) {
		this.key = key;
		this.container = container;
		this.value = value;
		this.lifecycle = lifecycle;
	};

	///////////////////////////////////////////////////////////////////////////////////////////////////////////////
	var cacheItem = function(reg, instance) {
		this.registration = reg;
		this.instance = instance;
	};

	///////////////////////////////////////////////////////////////////////////////////////////////////////////////
	var perRequestLifecycle = function(container) {
		this.container = container;
		this.cache = [];
		this.refCounts = {};

		this.tag = 0;
		this.visitedKeys = {};
		this.visitedKeysArray = [];
	};

	perRequestLifecycle.prototype = {
		get: function(key) {
			// Gets an instance for 'key' that has already been retrieved during the current resolve. The current resolve is identified by 'tag'.
			// If there is no available instance, it will also do a check to determine if there's a circular reference during.
			for (var t=0,len = this.cache.length;t<len;t++) {
				var i = this.cache[t];
				if (i.registration.key === key && i.tag === this.tag) {
					if (!i.instance) break;
					this.set(i);
					return i.instance;
				}
			}

			this.visitedKeysArray.push(key);
			if (this.visitedKeys[key]) {
				throw new Error("Circular reference: " + this.visitedKeysArray.join(" --> "));
			}
			this.visitedKeys[key] = true;

			return null;
		},

		set: function(cacheItem) {
			this.cache.push(cacheItem);
			cacheItem.tag = this.tag;

			this.refCounts[cacheItem.tag] = this.refCounts[cacheItem.tag] || {};
			this.refCounts[cacheItem.tag][cacheItem.registration.key] = this.refCounts[cacheItem.tag][cacheItem.registration.key]++ || 1;
		},

		release: function(cacheItem) {
			return !--this.refCounts[cacheItem.tag][cacheItem.registration.key];
		},

		resolveStarted: function(key) {
			this.tag++;
			this.visitedKeys = {};
			this.visitedKeysArray = [];
		}
	};

	///////////////////////////////////////////////////////////////////////////////////////////////////////////////
	var singletonLifecycle = function(container, parentLifecycle) {
		this.container = container;
		this.cache = [];
		this.refCounts = {};
		this.parent = parentLifecycle;
	};

	singletonLifecycle.prototype = {
		get: function(key) {
			// Re-use any instance that is already available for this dependency
			for (var t=0,len = this.cache.length;t<len;t++) {
				var i = this.cache[t];
				if (i.registration.key === key) {
					if (!i.instance) break;
					this.set(i);
					return i.instance;
				}
			}
			
			// If the singleton wasn't found, maybe it is available in the parent
			if (this.parent) return this.parent.get(key);
			else return null;
		},

		set: function(cacheItem) {
			this.cache.push(cacheItem);
			this.refCounts[cacheItem.registration.key] = this.refCounts[cacheItem.registration.key]++ || 1;
		},

		release: function(cacheItem) {
			return !--this.refCounts[cacheItem.registration.key];
		},

		resolveStarted: function(key) {
		}
	};

	///////////////////////////////////////////////////////////////////////////////////////////////////////////////
	var uniqueLifecycle = function(container) {
		this.container = container;
		this.cache = [];
	};

	uniqueLifecycle.prototype = {
		get: function(key) {
			return null;
		},

		set: function(cacheItem) {
			this.cache.push(cacheItem);
		},

		release: function(cacheItem) {
			return true;
		},

		resolveStarted: function(key) {
		}
	};

	///////////////////////////////////////////////////////////////////////////////////////////////////////////////
	var nullableFacility = {
		suffixes: ["?"],

		beforeResolve: function(container, key, reg) {
			if (reg) return {
				// We don't want to handle non-null instances
				handled: false
			}
			else {
				return {
					handled: true,
					data: null
				}
			}
		}
	};

	///////////////////////////////////////////////////////////////////////////////////////////////////////////////
	var factoryInstance = function(container, key) {
		this.container = container.create();
		this.key = key;
		
		exportProperty(this, "dispose", this.dispose);
		exportProperty(this, "get", this.get);
		exportProperty(this, "use", this.use);
	};

	factoryInstance.prototype = {
		get: function() {
			var args = Array.prototype.slice.call(arguments);
			args.unshift(this.key);

			var instance = this.container.get.apply(this.container, args);
			instance.$containerFactoryInstance = this;
			return instance;
		},

		use: function(key, value, lifecycle) {
			this.container.register(key, value, lifecycle);
			return this;
		},

		dispose: function() {
			this.container.dispose();
		}
	};

	///////////////////////////////////////////////////////////////////////////////////////////////////////////////
	var factory = function(container, key) {
		this.container = container;
		this.key = key;
		
		exportProperty(this, "dispose", this.dispose);
		exportProperty(this, "get", this.get);
		exportProperty(this, "use", this.use);
	};

	factory.prototype = {
		get: function() {
			var fi = new factoryInstance(this.container, this.key);
			return fi.get.apply(fi, arguments);
		},

		use: function(key, value, lifecycle) {
			var fi = new factoryInstance(this.container, this.key);
			return fi.use(key, value, lifecycle);
		},

		dispose: function(obj) {
			obj.$containerFactoryInstance.dispose();
			delete obj.$containerFactoryInstance;
		}
	};

	var factoryFacility = {
		suffixes: ["Factory", "!"],

		resolve: function(container, key, reg) {
			var _this = this;
			return {
				handled: true,
				data: new factory(container, key)
			}
		}
	};

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
	var container = function(options, parent) {
		this.registry = {};
		this.parent = parent;
		this.lifecycles = {
			"perRequest": new perRequestLifecycle(this),
			"singleton": new singletonLifecycle(this, parent ? parent.lifecycles["singleton"] : null),
			"unique": new uniqueLifecycle(this)
		};
		this.children = [];

		options = options || {};
		this.options = options;

		this.register("container", this);

		exportProperty(this, "dispose", this.dispose);
		exportProperty(this, "get", this.get);
		exportProperty(this, "register", this.register);
	};

	var getFacility = function(container, key) {
		for (var facilityName in container.facilities) {
			var facility = container.facilities[facilityName];
			for (var t=0,len = facility.suffixes.length;t<len;t++) {
				var suffix = facility.suffixes[t];
				if (key.indexOf(suffix, key.length - suffix.length) !== -1) {
					return {
						data: facility,
						key: key.slice(0, key.length - suffix.length)
					};
				}
			}
		}

		return {
			data: null,
			key: key
		};
	};

	var get = function(container, key, extraInjections) {
		var facility = getFacility(container, key);
		key = facility.key;
		facility = facility.data;

		// Try to find the dependency registration in the current container.
		// If not found, recursively try the parent container.
		var reg;
		var currentContainer = container;
		while (currentContainer) {
			reg = currentContainer.registry[key];
			if (!reg) currentContainer = currentContainer.parent;
			else break;
		}

		if (facility && facility.beforeResolve) {
			var result = facility.beforeResolve(container, key, reg);
			if (result.handled) return result.data;
		}

		if (!currentContainer) {
			throw new Error("Unknown dependency: " + key);
		}

		if (facility && facility.resolve) {
			var result = facility.resolve(container, key, reg);
			if (result.handled) return result.data;
		}

		// Ask the lifecycle if it already has an instance of this dependency
		var instance;
		if (instance = container.lifecycles[reg.lifecycle].get(key)) {
			return instance;
		}

		var returnValue;

		// Lifecycle didn't have an instance, so we need to create it.
		// If the registered value is a function we use it as a constructor.
		// Otherwise, we simply return the registered value.
		//if (reg.value instanceof Function && reg.value.provider) {
		if (reg.value instanceof Function) {

			var f= reg.value
			var instance= (function(f,container){
				return function(){
					//if(!(this instanceof InjectedConstructor))
					//	return newDynamic(MAGIC_ARGS_NEW, arguments)
					//var args= arguments.length == 2 && arguments[0] == MAGIC_ARGS_NEW ? arguments[1] : arguments
	
					var injections = f["$inject"];
					var resolvedInjections = [];
					if (injections instanceof Array) {
						for (var t=0,len = injections.length;t<len;t++) {
							var injectionKey = injections[t];
							resolvedInjections.push(get(container, injectionKey, []));
						}
					}
					for(var i in arguments)
						resolvedInjections.push(arguments[i])
					var rv= f.apply(this,resolvedInjections)
					if(rv)
						return rv
					return this
				}
			}(f,container))

			instance.prototype= f.prototype
			for (var propertyName in f) {
				if (f.hasOwnProperty(propertyName)) instance[propertyName] = f[propertyName];
			}

			//returnValue= instance
			//instance= null

		} else {
			// The registered value is an existing instance.
			instance = reg.value;
		}

		container.lifecycles[reg.lifecycle].set(new cacheItem(reg, instance));

		// If the returnValue is set, we should return that instead of the instance.
		return returnValue || instance;
	};

	container.prototype = {
		facilities: {
			nullable: nullableFacility,
			factory: factoryFacility
		},

		register: function(key, value, lifecycle) {
			// Conflicts with facility names?
			if (getFacility(this, key).data) throw new Error("Cannot register dependency: " + key);

			if (!lifecycle) {
				// update registration, if possible
				if (this.registry[key]) {
					this.registry[key].value = value;
					return;
				}
			}
			this.registry[key] = new registration(key, this, value, lifecycle || "perRequest");
		},

		get: function(key) {
			for (var lifecycleName in this.lifecycles) {
				if (this.lifecycles.hasOwnProperty(lifecycleName)) this.lifecycles[lifecycleName].resolveStarted(key);
			}

			var extraInjections = Array.prototype.slice.call(arguments).slice(1);

			var container = this;
			var value;
			while (container && (value = get(container, key, extraInjections)) === null) {
				container = container.parent;
			}

			return value;
		},

		dispose: function() {
			var item;

			while (item = this.children.pop()) {
				item.dispose();
			}

			var cache = this.getCachedObjects();
			while (item = cache.pop()) {
				if (this.lifecycles[item.registration.lifecycle].release(item)) {
					if (this.options["onDispose"]) {
						this.options["onDispose"](item.instance, item.registration.key);
					}
				}
			}
			return true;
		},

		create: function(options) {
			options = options || {};
			options["onDispose"] = options["onDispose"] || this.options["onDispose"];
			var child = new container(options, this);
			this.children.push(child);
			return child;
		},

		getCachedObjects: function() {
			var result = [];
			for (var lifecycleName in this.lifecycles) {
				if (this.lifecycles.hasOwnProperty(lifecycleName)) result = result.concat(this.lifecycles[lifecycleName].cache);
			}
			return result;
		}
	};

	///////////////////////////////////////////////////////////////////////////////////////////////////////////////
	intravenous.create = function(options) {
		return new container(options);
	};

	exportSymbol("create", intravenous.create);
}());

