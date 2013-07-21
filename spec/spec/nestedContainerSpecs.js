describe("A nested container", function() {
    beforeEach(function() {
        var _this = this;

        this.disposalCount = {};
        this.baseContainer = intravenous.create({
            onDispose: function(obj, key) {
                if (!_this.disposalCount[key]) _this.disposalCount[key] = 0;
                _this.disposalCount[key]++;
            }
        });
        this.baseContainer.register("a", "a");
    });

    describe("when created", function() {
        beforeEach(function() {
            this.container = this.baseContainer.create();
            this.container = this.container.create(); // nest another level
            this.container.register("b", "b");

            this.d = function(a, b, c) {
                this.a = a;
                this.b = b;
                this.c = c;
            };
            this.d.$inject = ["a", "b", "c?"];
            this.container.register("d", this.d);
        });

        it("can be created from base container", function() {
            expect(this.container).toBeDefined();
        });

        it("takes the base container options when not overridden", function() {
            expect(this.container.options).toEqual(this.baseContainer.options);
        });

        it("retrieves the same instances", function() {
            expect(this.container.get("a")).toBe(this.baseContainer.get("a"));
        });

        it("retrieves itself for a container dependency", function() {
           expect(this.container.get("container")).toBe(this.container);
        });

        describe("when retrieving an instance", function() {
            beforeEach(function() {
                this.d = this.container.get("d");
            });

            it("retrieves an instance from the base container", function() {
                expect(this.d().a).toEqual("a");
            });

            it("retrieves an instance from the container", function() {
                expect(this.d.b).toEqual("b");
            });

            it("still allows nullable dependencies", function() {
                expect(this.d.c).toBeNull();
            });
        });
    });

    describe("when created with overridden options", function() {
        beforeEach(function() {
            this.container = this.baseContainer.create({
                onDispose: function() {}
            });
        });

        it("does not take the base container options", function() {
            expect(this.container.options).not.toEqual(this.baseContainer.options);
        });
    });

    describe("when disposed through the base", function() {
        beforeEach(function() {
            this.container = this.baseContainer.create();
            this.baseRetrievedA = this.baseContainer.get("a");
            this.retrievedA = this.container.get("a");
            this.baseContainer.dispose();
        });

        it("should dispose the nested container as well", function() {
            expect(this.disposalCount.a).toBe(2);
        });
    });

    describe("when disposed through the nested container", function() {
        beforeEach(function() {
            this.container = this.baseContainer.create();
            this.baseRetrievedA = this.baseContainer.get("a");
            this.retrievedA = this.container.get("a");
            this.container.dispose();
        });

        it("should only dispose items created through the nested container", function() {
            expect(this.disposalCount.a).toBe(1);
        });
    });

    describe("with a singleton registration", function() {
        beforeEach(function() {
            this.container = this.baseContainer.create();
			
			var _this = this;
			this.singletons = 0;
			this.singleton = function() {
				_this.singletons++;
				this.items = [];
			};
			
            this.container.register("singleton", this.singleton, "singleton");
            this.container.get("singleton");
        });
		
		describe("when created in the root and a nested container", function() {
			beforeEach(function() {
				this.rootItem = function(singleton, nestedItemFactory) {
					this.singleton = singleton;
					this.singleton.items.push("root");
					this.nestedItem = nestedItemFactory.get();
				};
				this.rootItem.$inject = ["singleton", "nestedItemFactory"];
				this.container.register("rootItem", this.rootItem);
				
				this.nestedItem = function(singleton) {
					this.singleton = singleton;
					this.singleton.items.push("nested");
				};
				this.nestedItem.$inject = ["singleton"];
				this.container.register("nestedItem", this.nestedItem);
			});
			
			it("should create only one singleton", function() {
				expect(this.singletons).toBe(1);
			});
			
			it("should return the same instance", function() {
				var rootItem = this.container.get("rootItem");
				var nestedItem = rootItem.nestedItem;
				expect(rootItem.singleton.items.length).toBe(2);
				expect(rootItem.singleton).toEqual(nestedItem.singleton);
			});
		});

        describe("when disposed", function() {
            beforeEach(function() {
               this.container.dispose();
            });

            it("does not dispose singletons from a base container", function() {
                expect(this.disposalCount.singleton).toBe(1);
            });
        });

        describe("when disposing the base container", function() {
            beforeEach(function() {
                this.baseContainer.dispose();
            });

            it("does dispose singletons in all containers", function() {
                expect(this.disposalCount.singleton).toBe(1);
            });
        });
    });
});
