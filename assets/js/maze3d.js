(function() {
    var width = window.innerWidth * 0.995;
    var height = window.innerHeight * 0.995;
    var canvasContainer = document.getElementById("canvasContainer");
    var renderer, camera, scene;
    var input, levelHelper, cameraHelper;
    var map = [];
    var running = false;
    var isWarmUp = true; 

    var experimentMode = null; 
    var _plActive = false;
    var _mouseSensitivity = 0.002;
    var _keys = { w: false, a: false, s: false, d: false };

    // === Fire & Smoke ===
    var fireSystem, smokeSystem;
    var fireParticles = 1200;
    var smokeParticles = 1500;
    var experimentStartTime = 0;
    var exitPosition = new THREE.Vector3(); 
    var hasExit = false;
    var warmUpTimer = 0;

    // === Data Logging ===
    var viewportLogs = [], minimapLogs = { hovers: {} }, gazeLogs = []; 
    var lastLogTime = 0, LOG_INTERVAL = 250; 
    var gazeBuffer = [], GAZE_BUFFER_SIZE = 8;

    // === Calibration ===
    var calibPoints = [[10,10], [50,10], [90,10], [10,50], [50,50], [90,50], [10,90], [50,90], [90,90]];
    var currentPointIdx = 0, clicksPerPoint = 5, currentClicks = 0;
    var mapScale = 16; 

    function $(id){ return document.getElementById(id); }
    function isWallCellByValue(v){ return (v != 1 && !isNaN(v)); }

    function createParticleTexture() {
        var canvas = document.createElement('canvas');
        canvas.width = 64; canvas.height = 64;
        var ctx = canvas.getContext('2d');
        var grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        grad.addColorStop(0.2, 'rgba(255,255,255,0.8)');
        grad.addColorStop(0.5, 'rgba(255,255,255,0.2)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 64, 64);
        var tex = new THREE.Texture(canvas);
        tex.needsUpdate = true;
        return tex;
    }

    window.startGame = function(mode) {
        experimentMode = mode;
        $('setup-screen').style.display = 'none';
        startCalibrationPhase();
    };

    function startCalibrationPhase() {
        $('calibration-overlay').style.display = 'block';
        initWebGazer(); 
        showNextCalibrationPoint();
    }

    function showNextCalibrationPoint() {
        if (currentPointIdx >= calibPoints.length) { finishCalibration(); return; }
        var overlay = $('calibration-overlay');
        var oldDot = $('calib-dot'); if (oldDot) oldDot.remove();
        var dot = document.createElement('div');
        dot.id = 'calib-dot';
        dot.style.cssText = `position: absolute; width: 25px; height: 25px; background: #e74c3c; border: 3px solid #fff; border-radius: 50%; cursor: pointer; left: ${calibPoints[currentPointIdx][0]}%; top: ${calibPoints[currentPointIdx][1]}%; transform: translate(-50%, -50%); z-index: 10000;`;
        dot.onclick = function() {
            currentClicks++;
            if (currentClicks >= clicksPerPoint) {
                currentPointIdx++; currentClicks = 0;
                $('calib-status').innerText = `Progress: ${currentPointIdx}/9 dots`;
                showNextCalibrationPoint();
            }
        };
        overlay.appendChild(dot);
    }

    function finishCalibration() {
        $('calibration-overlay').style.display = 'none';
        $('ui-layer').style.opacity = '1';
        initializeEngine();
        configureUIForMode(experimentMode);
        levelHelper = new Demonixis.GameHelper.LevelHelper();
        loadLevel(5); 
    }

    function initWebGazer() {
        if (typeof webgazer !== 'undefined') {
            webgazer.setGazeListener(function(data) {
                if (data && running) {
                    gazeBuffer.push({ x: data.x, y: data.y });
                    if (gazeBuffer.length > GAZE_BUFFER_SIZE) gazeBuffer.shift();
                    var avgX = gazeBuffer.reduce((s, p) => s + p.x, 0) / gazeBuffer.length;
                    var avgY = gazeBuffer.reduce((s, p) => s + p.y, 0) / gazeBuffer.length;
                    gazeLogs.push({ t: Date.now(), x: Math.round(avgX), y: Math.round(avgY) });
                }
            }).begin();
            webgazer.showVideoPreview(true).showPredictionPoints(true);
            
            var moveUI = setInterval(function(){
                var v = $('webgazerVideoFeed'), t = $('webgazer-target');
                if (v && t && v.parentElement !== t) {
                    t.innerHTML = '';
                    [v, $('webgazerVideoCanvas'), $('webgazerFaceOverlay'), $('webgazerFaceFeedbackBox')].forEach(el => {
                        if(el) { t.appendChild(el); el.style.cssText = "position:absolute; top:0; left:0; width:100%; height:100%; object-fit:cover; transform:scaleX(-1);"; }
                    });
                    clearInterval(moveUI);
                }
            }, 500);
        }
    }

    function initializeEngine() {
        if (renderer) return; 
        renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(width, height);
        scene = new THREE.Scene();
        scene.fog = new THREE.FogExp2(0x1a1a1a, 0.0005);
        camera = new THREE.PerspectiveCamera(45, width / height, 1, 10000);
        document.getElementById("canvasContainer").appendChild(renderer.domElement);
        input = new Demonixis.Input();
        cameraHelper = new Demonixis.GameHelper.CameraHelper(camera);
        cameraHelper.translation = 5; cameraHelper.rotation = 0.04;

        setupPointerLock();
        setupMinimapTracking();
        window.addEventListener("resize", function() { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
        window.addEventListener("keydown", (e) => { if(_keys.hasOwnProperty(e.key.toLowerCase())) _keys[e.key.toLowerCase()] = true; });
        window.addEventListener("keyup", (e) => { if(_keys.hasOwnProperty(e.key.toLowerCase())) _keys[e.key.toLowerCase()] = false; });
    }

    function initFireEffects() {
        if (isWarmUp) return; 
        var tex = createParticleTexture();
        var fireGeo = new THREE.Geometry();
        for (var i = 0; i < fireParticles; i++) {
            fireGeo.vertices.push(new THREE.Vector3(exitPosition.x+(Math.random()-0.5)*100, Math.random()*50, exitPosition.z+(Math.random()-0.5)*100));
        }
        var fireMat = new THREE.PointsMaterial({ map: tex, color: 0xff4400, size: 25, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false });
        fireSystem = new THREE.Points(fireGeo, fireMat);
        scene.add(fireSystem);

        var smokeGeo = new THREE.Geometry();
        for (var i = 0; i < smokeParticles; i++) {
            smokeGeo.vertices.push(new THREE.Vector3((Math.random()-0.5)*3500, Math.random()*200, (Math.random()-0.5)*3500));
        }
        var smokeMat = new THREE.PointsMaterial({ map: tex, color: 0x222222, size: 80, transparent: true, opacity: 0.3, depthWrite: false });
        smokeSystem = new THREE.Points(smokeGeo, smokeMat);
        scene.add(smokeSystem);
        experimentStartTime = Date.now();
    }

    function updateEffects() {
        if (!fireSystem || isWarmUp) return;
        fireSystem.geometry.vertices.forEach(v => {
            v.y += 1.5 + Math.random();
            if (v.y > 90) { v.y = 0; v.x = exitPosition.x+(Math.random()-0.5)*120; v.z = exitPosition.z+(Math.random()-0.5)*120; }
        });
        fireSystem.geometry.verticesNeedUpdate = true;
        smokeSystem.geometry.vertices.forEach(v => {
            v.y += 0.3; if (v.y > 180) v.y = 0;
            v.x += Math.sin(Date.now()*0.0005)*0.2;
        });
        smokeSystem.geometry.verticesNeedUpdate = true;
        if (scene.fog.density < 0.015) scene.fog.density += 0.000008;
    }

    function moveCamera(dir) {
        if (dir === "left") { camera.rotation.y += cameraHelper.rotation; return; }
        if (dir === "right") { camera.rotation.y -= cameraHelper.rotation; return; }
        var dx = 0, dz = 0, rot = camera.rotation.y;
        if (dir === "up") { dx = -Math.sin(rot) * cameraHelper.translation; dz = -Math.cos(rot) * cameraHelper.translation; }
        else if (dir === "down") { dx = Math.sin(rot) * cameraHelper.translation; dz = Math.cos(rot) * cameraHelper.translation; }
        var r = 15;
        var isWall = function(x, z) {
            var tx = Math.floor((x - cameraHelper.origin.x + 50) / 100);
            var ty = Math.floor((z - cameraHelper.origin.z + 50) / 100);
            if (ty < 0 || ty >= map.length || tx < 0 || tx >= map[0].length) return true;
            if (map[ty][tx] === "A") { nextLevel(); return false; } 
            return (map[ty][tx] != 1 && !isNaN(map[ty][tx])); 
        };
        var checkCol = (x, z) => isWall(x+r, z+r) || isWall(x-r, z+r) || isWall(x+r, z-r) || isWall(x-r, z-r);
        var nx = camera.position.x + dx, nz = camera.position.z + dz;
        if (!checkCol(nx, nz)) { camera.position.x = nx; camera.position.z = nz; }
    }

    function nextLevel() {
        running = false;
        if (isWarmUp) {
            isWarmUp = false;
            // 修复：显式重置镜头方向，防止继承 Warmup 时的旋转状态
            camera.rotation.set(0, 0, 0); 
            alert("Warm-up over. Starting formal experiment (Map 1) with fire simulation.");
            loadLevel(1); 
        } else {
            alert("Experiment Complete! Please download your logs.");
        }
    }

    function update() {
        if (input.keys.up || _keys.w) moveCamera("up");
        if (input.keys.down || _keys.s) moveCamera("down");
        if (input.keys.left || _keys.a) moveCamera("left");
        if (input.keys.right || _keys.d) moveCamera("right");
        updateMiniMapOverlay();
        updateEffects();
        if (isWarmUp) {
            warmUpTimer++;
            if (warmUpTimer > 1800) nextLevel(); 
        }
        var now = Date.now();
        if (now - lastLogTime > LOG_INTERVAL) {
            viewportLogs.push({ t: now, x: camera.position.x.toFixed(1), z: camera.position.z.toFixed(1), rot: camera.rotation.y.toFixed(3), fog: scene.fog.density.toFixed(6) });
            lastLogTime = now;
        }
    }

    function initializeScene() {
        while(scene.children.length > 0){ scene.remove(scene.children[0]); }
        var loader = new THREE.TextureLoader();
        var pW = map[0].length * 100, pH = map.length * 100;
        scene.add(new THREE.Mesh(new THREE.BoxGeometry(pW, 5, pH), new THREE.MeshPhongMaterial({ map: loader.load("assets/images/textures/ground_diffuse.jpg") })).translateY(1));
        scene.add(new THREE.Mesh(new THREE.BoxGeometry(pW, 5, pH), new THREE.MeshPhongMaterial({ map: loader.load("assets/images/textures/roof_diffuse.jpg") })).translateY(100));
        var wallGeo = new THREE.BoxGeometry(100, 100, 100);
        var wallMat = new THREE.MeshPhongMaterial({ map: loader.load("assets/images/textures/wall_diffuse.jpg") });
        var xrayMat = new THREE.MeshBasicMaterial({ color: 0x0088ff, transparent: true, opacity: 0.1, depthWrite: false });
        for (var y = 0; y < map.length; y++) {
            for (var x = 0; x < map[y].length; x++) {
                var px = -pW / 2 + 100 * x, pz = -pH / 2 + 100 * y;
                if (x == 0 && y == 0) { cameraHelper.origin.x = px; cameraHelper.origin.z = pz; }
                if (map[y][x] > 1) {
                    var m = (experimentMode === 'minimap') ? new THREE.Mesh(wallGeo, wallMat) : new THREE.Mesh(wallGeo, xrayMat);
                    m.position.set(px, 50, pz); scene.add(m);
                }
                if (map[y][x] === "D") camera.position.set(px, 50, pz);
                if (map[y][x] === "A") {
                    exitPosition.set(px, 50, pz); hasExit = true;
                    var g = new THREE.Mesh(new THREE.BoxGeometry(20, 100, 20), new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.6 }));
                    g.position.set(px, 50, pz); scene.add(g);
                }
            }
        }
        scene.add(new THREE.HemisphereLight(0x888888, 0x111111, 1.2));
        drawMiniMapStatic();
        initFireEffects();
    }

    function mainLoop() { if (running) { update(); renderer.render(scene, camera); requestAnimationFrame(mainLoop); } }

    function loadLevel(l) {
        var ajax = new XMLHttpRequest();
        ajax.open("GET", "assets/maps/maze3d-" + l + ".json", true);
        ajax.onreadystatechange = function() {
            if (ajax.readyState == 4) { map = JSON.parse(ajax.responseText); initializeScene(); running = true; mainLoop(); }
        };
        ajax.send(null);
    }

    function setupPointerLock() {
        var el = renderer.domElement;
        el.onclick = () => { if(!running) return; el.requestPointerLock(); };
        document.addEventListener('pointerlockchange', () => { _plActive = (document.pointerLockElement === el); });
        document.addEventListener('mousemove', (e) => { 
            // 修复：仅当 PointerLock 激活且游戏正在运行（非 Alert 状态）时才应用旋转
            if (_plActive && running) {
                camera.rotation.y -= e.movementX * _mouseSensitivity; 
            }
        });
    }

    // ... 其余辅助函数保持不变 (drawMiniMapStatic, updateMiniMapOverlay, worldToTileFloat) ...
    function drawMiniMapStatic() {
        var mm = $("minimap"), o = $("objects"); if (!mm || !o) return;
        mm.width = o.width = map[0].length * mapScale; mm.height = o.height = map.length * mapScale;
        var ctx = mm.getContext("2d");
        for (var y=0; y<map.length; y++) {
            for (var x=0; x<map[0].length; x++) {
                ctx.fillStyle = isWallCellByValue(map[y][x]) ? "#333" : "#eee";
                ctx.fillRect(x*mapScale, y*mapScale, mapScale, mapScale);
            }
        }
    }

    function updateMiniMapOverlay() {
        var o = $("objects"); if (!o || experimentMode === 'xray') return;
        var ctx = o.getContext("2d"); ctx.clearRect(0, 0, o.width, o.height);
        var p = worldToTileFloat(camera.position.x, camera.position.z);
        var tx = p.tx * mapScale, ty = p.ty * mapScale;
        ctx.fillStyle = "#00f0ff"; ctx.beginPath(); ctx.arc(tx, ty, 4, 0, Math.PI * 2); ctx.fill();
        var rot = camera.rotation.y, lineLength = 20; 
        ctx.strokeStyle = "#00f0ff"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(tx, ty);
        ctx.lineTo(tx - Math.sin(rot) * lineLength, ty - Math.cos(rot) * lineLength);
        ctx.stroke();
    }

    function worldToTileFloat(wx, wz) {
        var pW = map[0].length * 100, pH = map.length * 100;
        return { tx: (wx + pW/2) / 100 + 0.2, ty: (wz + pH/2) / 100 + 0.4 };
    }

    window.downloadMazeData = function() {
        var data = { mode: experimentMode, viewport: viewportLogs, eye: gazeLogs };
        var a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type : 'application/json'}));
        a.download = `maze_study_${Date.now()}.json`; a.click();
    };

    function configureUIForMode(m) {
        $("hud-right").style.display = (m === 'minimap') ? 'flex' : 'none';
        if($("btn-toggle-map")) $("btn-toggle-map").style.display = (m === 'minimap') ? 'flex' : 'none';
    }

    function setupMinimapTracking() {
        var o = $("objects"); if (!o) return;
        o.addEventListener('mousemove', (e) => {
            var r = o.getBoundingClientRect();
            var gx = Math.floor(((e.clientX - r.left) * (o.width / r.width)) / mapScale);
            var gy = Math.floor(((e.clientY - r.top) * (o.height / r.height)) / mapScale);
            if (gx >= 0 && gy >= 0 && gy < map.length && gx < map[0].length) minimapLogs.hovers[`${gx},${gy}`] = (minimapLogs.hovers[`${gx},${gy}`] || 0) + 1;
        });
    }
})();