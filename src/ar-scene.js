var Cesium = Argon.Cesium;
var Cartesian3 = Argon.Cesium.Cartesian3;
var ReferenceFrame = Argon.Cesium.ReferenceFrame;
var JulianDate = Argon.Cesium.JulianDate;
var CesiumMath = Argon.Cesium.CesiumMath;
var AEntity = AFRAME.AEntity;
var ANode = AFRAME.ANode;

var AR_CAMERA_ATTR = "argon-aframe-ar-camera";

// want to know when the document is loaded 
document.DOMReady = function () {
	return new Promise(function(resolve, reject) {
		if (document.readyState === 'complete') {
			resolve(document);
		} else {
			document.addEventListener('DOMContentLoaded', function() {
			    resolve(document);
		    });
		}
	});
};

document.registerElement('ar-scene', {
  prototype: Object.create(AEntity.prototype, {
    defaultComponents: {
      value: {
        'camera': ''    // need a vanilla camera to prevent the disable the default one
      }
    },

    createdCallback: {
      value: function () {
        this.isMobile = false;
        this.isIOS = false;
        this.isScene = true;
        this.object3D = new THREE.Scene();
        this.systems = {};
        this.time = 0;
        this.startTime = null;
        this.argonApp = null;
        
        // finish initializing
        this.init();
      }
    },

    init: {
      value: function () {
        this.behaviors = [];
        this.hasLoaded = false;
        this.isPlaying = false;
        this.originalHTML = this.innerHTML;
        this.setupSystems();

        this.render = this.render.bind(this);
        this.update = this.update.bind(this);
        this.initializeArgon = this.initializeArgon.bind(this);
        this.setupRenderer = this.setupRenderer.bind(this);

        // var arCameraEl = this.arCameraEl = document.createElement('a-entity');
        // arCameraEl.setAttribute(AR_CAMERA_ATTR, '');
        // arCameraEl.setAttribute('camera', {'active': true});
        // this.sceneEl.appendChild(arCameraEl);

        // run this whenever the document is loaded, which might be now
        //document.DOMReady().then(this.initializeArgon);
        this.initializeArgon();
      },
      writable: true 
    },

    /**
     * Handler attached to elements to help scene know when to kick off.
     * Scene waits for all entities to load.
     */
    attachedCallback: {
      value: function () {
        this.play();
      },
      writable: window.debug
    },

    play: {
      value: function () {
        var self = this;
        if (this.renderStarted) {
          AEntity.prototype.play.call(this);
          return;
        }

        this.addEventListener('loaded', function () {
          if (this.renderStarted) { return; }

          // if we've initialized argon, set up callbacks
          if (this.argonApp) {
            this.argonApp.renderEvent.addEventListener(this.render);
            this.argonApp.updateEvent.addEventListener(this.update);
          }

          AEntity.prototype.play.call(this);

          if (window.performance) {
              window.performance.mark('render-started');
          }

          this.renderStarted = true;
          this.emit('renderstart');
        });

        // setTimeout to wait for all nodes to attach and run their callbacks.
        setTimeout(function () {
          AEntity.prototype.load.call(self);
        });
      }
    },

    /**
     * Shuts down scene on detach.
     */
    detachedCallback: {
      value: function () {
        this.argonApp.updateEvent.removeEventListener(this.update);
        this.argonApp.renderEvent.removeEventListener(this.render);
      }
    },

    initializeArgon: {
        value: function () {
            this.argonApp = Argon.init();
            this.startTime = this.argonApp.context.getTime();
            if (this.startTime) this.startTime = this.startTime.clone();
            this.argonApp.context.setDefaultReferenceFrame(this.argonApp.context.localOriginEastUpSouth);

            this.setupRenderer();

            // if we've already initialized the rendering, we won't have
            // set these callbacks, so do it now
            if (this.renderStarted) {
                this.argonApp.renderEvent.addEventListener(this.render);
                this.argonApp.updateEvent.addEventListener(this.update);
            }
        },
        writable: true
    },

    setupRenderer: {
      value: function () {        
        var scene = this.object3D;
        var antialias = this.getAttribute('antialias') === 'true';

        this.cssRenderer = new THREE.CSS3DArgonRenderer();
        this.hud = new THREE.CSS3DArgonHUD();
        this.webglRenderer = new THREE.WebGLRenderer({
            alpha: true,
            antialias: antialias,
            logarithmicDepthBuffer: true
        });
        this.webglRenderer.setPixelRatio(window.devicePixelRatio);

        this.argonApp.view.element.appendChild(this.webglRenderer.domElement);
        this.argonApp.view.element.appendChild(this.cssRenderer.domElement);
        this.argonApp.view.element.appendChild(this.hud.domElement);
      },
      writable: true
    },


    /**
     * Reload the scene to the original DOM content.
     *
     * @param {bool} doPause - Whether to reload the scene with all dynamic behavior paused.
     */
    reload: {
      value: function (doPause) {
        var self = this;
        if (doPause) { this.pause(); }
        this.innerHTML = this.originalHTML;
        this.init();
        ANode.prototype.load.call(this, play);
        function play () {
          if (!self.isPlaying) { return; }
          AEntity.prototype.play.call(self);
        }
      }
    },

    /**
     * Behavior-updater meant to be called from scene render.
     * Abstracted to a different function to facilitate unit testing (`scene.tick()`) without
     * needing to render.
     */
    update: {
        value: function () {
            var time = 0;
            if (this.startTime) 
                time = JulianDate.secondsDifference(this.argonApp.context.getTime(), 
                                                    this.startTime);
        
            var timeDelta = time - this.time;
            if (timeDelta > 0.5) {
                timeDelta = 0;  // large deltas make no sense in most cases 
            }

            if (this.isPlaying) {
                this.tick(time, timeDelta);
            }

            this.time = time;   
        },
        writable: true
    },

    tick: {
      value: function (time, timeDelta) {
        var systems = this.systems;

        // Animations.
        TWEEN.update(time);

        // Components.
        this.behaviors.forEach(function (component) {
            if (!component.el.isPlaying) { return; }
            component.tick(time, timeDelta);
        });
        // Systems.
        Object.keys(systems).forEach(function (key) {
            if (!systems[key].tick) { return; }
            try {
                systems[key].tick(time, timeDelta);
            } catch (e) {
                // nada!
            }
        });
      }
    },

    /**
     * The render loop.
     *
     * Updates animations.
     * Updates behaviors.
     * Renders with request animation frame.
     */
    render: {
      value: function () {
        var app = this.argonApp;
        var scene = this.object3D;
        var webglRenderer = this.webglRenderer;
        var cssRenderer = this.cssRenderer;
        var hud = this.hud;
        var camera = this.camera;

        var viewport = app.view.getViewport();
        webglRenderer.setSize(viewport.width, viewport.height);
        cssRenderer.setSize(viewport.width, viewport.height);
        hud.setSize(viewport.width, viewport.height);

        // there is 1 subview in monocular mode, 2 in stereo mode    
        for (var _i = 0, _a = app.view.getSubviews(); _i < _a.length; _i++) {
            var subview = _a[_i];
            // set the position and orientation of the camera for 
            // this subview
            camera.position.copy(subview.pose.position);
            camera.quaternion.copy(subview.pose.orientation);
            // the underlying system provide a full projection matrix
            // for the camera. 
            camera.projectionMatrix.fromArray(subview.projectionMatrix);
            // set the viewport for this view
            var _b = subview.viewport, x = _b.x, y = _b.y, width = _b.width, height = _b.height;
            // set the CSS rendering up, by computing the FOV, and render this view
            cssRenderer.updateCameraFOVFromProjection(camera);
            cssRenderer.setViewport(x, y, width, height, subview.index);
            cssRenderer.render(scene, camera, subview.index);
            // set the webGL rendering parameters and render this view
            webglRenderer.setViewport(x, y, width, height);
            webglRenderer.setScissor(x, y, width, height);
            webglRenderer.setScissorTest(true);
            webglRenderer.render(scene, camera);
            // adjust the hud
            hud.setViewport(x, y, width, height, subview.index);
            hud.render(subview.index);
        }
      },
      writable: true
    },


    /**
     * Some mundane functions below here
     */
    setupSystems: {
      value: function () {
        var systemsKeys = Object.keys(AFRAME.systems);
        systemsKeys.forEach(this.initSystem.bind(this));
      }
    },

    initSystem: {
      value: function (name) {
        var system;
        if (this.systems[name]) { return; }
        system = this.systems[name] = new AFRAME.systems[name](this);
        system.init();
      }
    },

    /**
     * @param {object} behavior - Generally a component. Must implement a .update() method to
     *        be called on every tick.
     */
    addBehavior: {
      value: function (behavior) {
        var behaviors = this.behaviors;
        if (behaviors.indexOf(behavior) !== -1) { return; }
        behaviors.push(behavior);
      }
    },

    /**
     * Wraps Entity.getAttribute to take into account for systems.
     * If system exists, then return system data rather than possible component data.
     */
    getAttribute: {
      value: function (attr) {
        var system = this.systems[attr];
        if (system) { return system.data; }
        return AEntity.prototype.getAttribute.call(this, attr);
      }
    },

    /**
     * Wraps Entity.getComputedAttribute to take into account for systems.
     * If system exists, then return system data rather than possible component data.
     */
    getComputedAttribute: {
      value: function (attr) {
        var system = this.systems[attr];
        if (system) { return system.data; }
        return AEntity.prototype.getComputedAttribute.call(this, attr);
      }
    },

    /**
     * Wraps Entity.setAttribute to take into account for systems.
     * If system exists, then skip component initialization checks and do a normal
     * setAttribute.
     */
    setAttribute: {
      value: function (attr, value, componentPropValue) {
        var system = this.systems[attr];
        if (system) {
          ANode.prototype.setAttribute.call(this, attr, value);
          return;
        }
        AEntity.prototype.setAttribute.call(this, attr, value, componentPropValue);
      }
    },

    /**
     * @param {object} behavior - Generally a component. Has registered itself to behaviors.
     */
    removeBehavior: {
      value: function (behavior) {
        var behaviors = this.behaviors;
        var index = behaviors.indexOf(behavior);
        if (index === -1) { return; }
        behaviors.splice(index, 1);
      }
    }
    
  })
});
