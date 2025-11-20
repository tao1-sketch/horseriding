(function () {
            const canvas = document.getElementById("race3dCanvas");
            const namesTextarea = document.getElementById("names3d");
            const startBtn = document.getElementById("start3d");
            const shuffleBtn = document.getElementById("shuffle3d");
            const resultEl = document.getElementById("result3d");
            const legendEl = document.getElementById("legend");

            const BASE_MIN_DURATION = 25000;
            const BASE_MAX_DURATION = 35000;
            const TWO_PI = Math.PI * 2;

            const baseTrackRadius = 18 * 1.7;
            const baseTrackWidth = 2.8;
            let trackWidth = baseTrackWidth;
            let laneGap = 0.8;

            const ellipseScaleX = 7.0; // 트랙크기
            const ellipseScaleZ = 2.8;
            const trackRadius = baseTrackRadius;
            const thetaStart = Math.PI / 2;

            const POST_FINISH_DURATION = 2500;
            const POST_FINISH_EXTRA_PROGRESS = 0.03;

            let renderer, scene, camera;
            let trackGroup = null;
            let horsesGroup = null;

            let horses = [];
            let durations = [];
            let phases = [];

            let winnerIndex = null;
            let raceFinished = false;
            let running = false;
            let countdownActive = false;
            let introActive = false;
            let introStartTime = 0;
            let raceStartTime = 0;
            let raceTotalTime = 0;

            let leaderIndex = 0;
            let lastIndex = 0;
            let cameraLeaderIndex = 0;
            let lastCameraLeaderSwitchTime = 0;

            let contestWindows = [];

            let postFinishStartTime = 0;
            let winnerFinishProgress = 1;

            const horseColors = [
                0xff5555, 0x55ff55, 0x5599ff, 0xffe066,
                0xff66cc, 0x66e0ff, 0xffffff, 0xff9933
            ];

            function clamp(v, min, max) {
                return v < min ? min : v > max ? max : v;
            }

            function disposeObject3D(obj) {
                obj.traverse(child => {
                    if (child.geometry) child.geometry.dispose();
                    if (child.material) {
                        if (Array.isArray(child.material)) {
                            child.material.forEach(m => {
                                if (!m) return;
                                if (m.map) m.map.dispose();
                                m.dispose();
                            });
                        } else {
                            const m = child.material;
                            if (!m) return;
                            if (m.map) m.map.dispose();
                            m.dispose();
                        }
                    }
                });
            }

            function initThree() {
                renderer = new THREE.WebGLRenderer({
                    canvas,
                    antialias: true
                });
                renderer.setPixelRatio(window.devicePixelRatio || 1);

                scene = new THREE.Scene();
                scene.background = new THREE.Color(0x05060b);

                const rect = canvas.getBoundingClientRect();
                let width = rect.width || 600;
                let height = rect.height || 400;

                camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);
                camera.position.set(0, 60, 90);
                camera.lookAt(0, 0, 0);

                renderer.setSize(width, height, false);

                const ambient = new THREE.AmbientLight(0xffffff, 0.45);
                scene.add(ambient);

                const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
                dirLight.position.set(20, 40, 20);
                scene.add(dirLight);

                const groundGeom = new THREE.PlaneGeometry(220, 220);
                const groundMat = new THREE.MeshPhongMaterial({
                    color: 0x0b0d12,
                    side: THREE.DoubleSide
                });
                const ground = new THREE.Mesh(groundGeom, groundMat);
                ground.rotation.x = -Math.PI / 2;
                ground.position.y = 0;
                scene.add(ground);

                trackGroup = new THREE.Group();
                trackGroup.scale.set(ellipseScaleX, 1, ellipseScaleZ);
                scene.add(trackGroup);

                horsesGroup = new THREE.Group();
                scene.add(horsesGroup);

                window.addEventListener("resize", onResize);
                requestAnimationFrame(animate);
            }

            function updateTrackWidthAndLaneGap(horseCount) {
                const n = Math.max(horseCount, 1);
                const horseRadialWidth = 0.7;
                const extraMargin = 1.5;
                const minWidth = baseTrackWidth;

                trackWidth = Math.max(minWidth, n * horseRadialWidth + extraMargin);

                if (n > 1) {
                    const safeMargin = 0.4;
                    laneGap = (trackWidth - safeMargin * 2) / (n - 1);
                    laneGap = Math.max(laneGap, 0.6);
                } else {
                    laneGap = 0;
                }
            }

            function getTrackPosition(theta, laneOffset, y) {
                const r = trackRadius + laneOffset;
                const x = Math.cos(theta) * r * ellipseScaleX;
                const z = Math.sin(theta) * r * ellipseScaleZ;
                return new THREE.Vector3(x, y, z);
            }

            function onResize() {
                if (!renderer || !camera) return;
                const rect = canvas.getBoundingClientRect();
                let width = rect.width || 600;
                let height = rect.height || 400;
                if (!width || !height) return;

                if (canvas.width !== width || canvas.height !== height) {
                    renderer.setSize(width, height, false);
                    camera.aspect = width / height;
                    camera.updateProjectionMatrix();
                }
            }

            function parseNames() {
                return namesTextarea.value
                    .split(/[\n\r,，;、\s]+/)
                    .map((s) => s.trim())
                    .filter(Boolean);
            }

            function createNameLabel(text) {
                const c = document.createElement("canvas");
                const ctx = c.getContext("2d");

                const fontSize = 14;
                const paddingX = 4;
                const paddingY = 3;
                const font = "bold " + fontSize + "px system-ui, -apple-system, 'Segoe UI', sans-serif";

                ctx.font = font;
                const textWidth = ctx.measureText(text).width;

                c.width = Math.ceil(textWidth + paddingX * 2);
                c.height = Math.ceil(fontSize + paddingY * 2);

                ctx.font = font;
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";

                ctx.clearRect(0, 0, c.width, c.height);
                ctx.fillStyle = "#ffffff";
                ctx.fillText(text, c.width / 2, c.height / 2);

                const tex = new THREE.CanvasTexture(c);
                tex.needsUpdate = true;

                const mat = new THREE.SpriteMaterial({
                    map: tex,
                    transparent: true,
                    depthTest: false
                });
                const sprite = new THREE.Sprite(mat);

                const worldWidth = 1.0;
                const aspect = c.height / c.width;
                sprite.scale.set(worldWidth, worldWidth * aspect, 1);
                sprite.position.set(0, 2.0, 0);

                return sprite;
            }

            function clearHorses() {
                if (horsesGroup) {
                    while (horsesGroup.children.length > 0) {
                        const obj = horsesGroup.children[0];
                        disposeObject3D(obj);
                        horsesGroup.remove(obj);
                    }
                }
                horses = [];
                durations = [];
                phases = [];
            }

            function rebuildTrackGeometry(horseCount) {
                if (!trackGroup) return;

                while (trackGroup.children.length > 0) {
                    const obj = trackGroup.children[0];
                    disposeObject3D(obj);
                    trackGroup.remove(obj);
                }

                updateTrackWidthAndLaneGap(horseCount);

                const innerR = trackRadius - trackWidth / 2;
                const outerR = trackRadius + trackWidth / 2;

                const trackGeom = new THREE.RingGeometry(innerR, outerR, 120);
                const trackMat = new THREE.MeshPhongMaterial({
                    color: 0xB57A3A,
                    emissive: 0x3b2610,
                    side: THREE.DoubleSide,
                    shininess: 15
                });
                const track = new THREE.Mesh(trackGeom, trackMat);
                track.rotation.x = -Math.PI / 2;
                track.position.y = 0.02;
                trackGroup.add(track);

                const lineMat = new THREE.MeshBasicMaterial({
                    color: 0xf5e6c8,
                    side: THREE.DoubleSide
                });
                const lineW = 0.10;
                const innerLineGeom = new THREE.RingGeometry(innerR - lineW, innerR, 120);
                const outerLineGeom = new THREE.RingGeometry(outerR, outerR + lineW, 120);
                const innerLine = new THREE.Mesh(innerLineGeom, lineMat);
                const outerLine = new THREE.Mesh(outerLineGeom, lineMat);
                innerLine.rotation.x = outerLine.rotation.x = -Math.PI / 2;
                innerLine.position.y = outerLine.position.y = 0.025;
                trackGroup.add(innerLine);
                trackGroup.add(outerLine);

                const stainMat = new THREE.MeshPhongMaterial({
                    color: 0x5A3A1A,
                    transparent: true,
                    opacity: 0.9,
                    side: THREE.DoubleSide
                });
                for (let i = 0; i < 60; i++) {
                    const angle = Math.random() * TWO_PI;
                    const offset = (Math.random() - 0.5) * (trackWidth - 0.4);
                    const r = trackRadius + offset;
                    const size = 0.4 + Math.random() * 1.5;

                    const stainGeom = new THREE.CircleGeometry(size, 16);
                    const stain = new THREE.Mesh(stainGeom, stainMat);
                    stain.rotation.x = -Math.PI / 2;
                    stain.position.set(
                        Math.cos(angle) * r,
                        0.03,
                        Math.sin(angle) * r
                    );
                    trackGroup.add(stain);
                }

                const startLineGeom = new THREE.PlaneGeometry(trackWidth + 0.6, 0.35);
                const startLineMat = new THREE.MeshBasicMaterial({
                    color: 0xff3333,
                    side: THREE.DoubleSide
                });
                const startLine = new THREE.Mesh(startLineGeom, startLineMat);
                startLine.rotation.x = -Math.PI / 2;
                startLine.rotation.z = thetaStart;
                startLine.position.set(
                    Math.cos(thetaStart) * trackRadius,
                    0.04,
                    Math.sin(thetaStart) * trackRadius
                );
                trackGroup.add(startLine);
            }

            function createHorseMesh(color) {
                const root = new THREE.Group();
                const horse = new THREE.Group();
                root.add(horse);

                const bodyMat = new THREE.MeshPhongMaterial({ color });
                const darkMat = new THREE.MeshPhongMaterial({ color: 0x222222 });

                const bodyGeom = new THREE.BoxGeometry(1.8, 0.7, 0.6);
                const body = new THREE.Mesh(bodyGeom, bodyMat);
                body.position.set(0, 0.7, 0);
                horse.add(body);

                const neckGeom = new THREE.BoxGeometry(0.4, 0.7, 0.4);
                const neck = new THREE.Mesh(neckGeom, bodyMat);
                neck.position.set(0.7, 1.2, 0);
                neck.rotation.z = -0.25;
                horse.add(neck);

                const headGeom = new THREE.BoxGeometry(0.6, 0.5, 0.4);
                const head = new THREE.Mesh(headGeom, bodyMat);
                head.position.set(1.3, 1.25, 0);
                horse.add(head);

                const legGeom = new THREE.BoxGeometry(0.2, 0.7, 0.2);
                const legPositions = [
                    [-0.6, 0.35, -0.22],
                    [-0.6, 0.35,  0.22],
                    [ 0.4, 0.35, -0.22],
                    [ 0.4, 0.35,  0.22]
                ];
                legPositions.forEach(pos => {
                    const leg = new THREE.Mesh(legGeom, darkMat);
                    leg.position.set(pos[0], pos[1], pos[2]);
                    horse.add(leg);
                });

                const tailGeom = new THREE.BoxGeometry(0.2, 0.5, 0.2);
                const tail = new THREE.Mesh(tailGeom, darkMat);
                tail.position.set(-1.0, 0.95, 0);
                tail.rotation.z = 0.35;
                horse.add(tail);

                return root;
            }

            function setHorseOrientation(h, pos, futurePos) {
                const mesh = h.mesh;
                const dir = futurePos.clone().sub(pos);
                dir.y = 0;
                if (dir.lengthSq() < 1e-6) {
                    if (typeof h.lastYaw === "number") {
                        mesh.rotation.set(0, h.lastYaw, 0);
                    }
                    return;
                }
                dir.normalize();
                const yaw = Math.atan2(dir.z, dir.x);
                const rotY = -yaw;
                mesh.rotation.set(0, rotY, 0);
                h.lastYaw = rotY;
                h.forward = dir.clone();
            }

            function updateLegendOrder() {
                if (!horses.length) return;
                const sorted = horses.slice().sort((a, b) => {
                    const aTheta = typeof a.theta === "number" ? a.theta : thetaStart;
                    const bTheta = typeof b.theta === "number" ? b.theta : thetaStart;
                    const aProg = (thetaStart - aTheta + TWO_PI) % TWO_PI;
                    const bProg = (thetaStart - bTheta + TWO_PI) % TWO_PI;
                    return bProg - aProg;
                });
                legendEl.innerHTML = "";
                sorted.forEach((h, idx) => {
                    const el = h.legendItem;
                    if (!el) return;
                    if (idx === 0) {
                        el.style.fontWeight = "700";
                        el.style.color = "#ffd567";
                        el.style.transform = "translateX(2px)";
                    } else {
                        el.style.fontWeight = "400";
                        el.style.color = "#f5f5f5";
                        el.style.transform = "translateX(0)";
                    }
                    legendEl.appendChild(el);
                });
            }

            function setupRace() {
                const names = parseNames();
                if (!names.length) {
                    alert("참가자를 한 명 이상 입력해 주세요.");
                    return;
                }

                running = false;
                raceFinished = false;
                countdownActive = false;
                introActive = false;
                raceTotalTime = 0;
                raceStartTime = 0;

                winnerIndex = null;
                leaderIndex = 0;
                lastIndex = 0;
                cameraLeaderIndex = 0;
                lastCameraLeaderSwitchTime = 0;

                contestWindows = [];

                postFinishStartTime = 0;
                winnerFinishProgress = 1;

                resultEl.textContent = "";
                legendEl.innerHTML = "";
                clearHorses();

                rebuildTrackGeometry(names.length);

                const n = names.length;
                const halfLane = (n - 1) / 2;

                names.forEach((name, idx) => {
                    const color = horseColors[idx % horseColors.length];
                    const mesh = createHorseMesh(color);

                    const laneIndex = idx - halfLane;
                    const laneBaseOffset = laneIndex * laneGap;
                    const laneOffset = laneBaseOffset;

                    const pos = getTrackPosition(thetaStart, laneOffset, 0.35);
                    mesh.position.copy(pos);

                    const futurePos = getTrackPosition(thetaStart - 0.01, laneOffset, 0.35);
                    setHorseOrientation({ mesh }, pos, futurePos);

                    const labelSprite = createNameLabel(name);
                    mesh.add(labelSprite);

                    horsesGroup.add(mesh);

                    const radial = new THREE.Vector3(pos.x, 0, pos.z);
                    if (radial.lengthSq() > 0.0001) radial.normalize();

                    const item = document.createElement("div");
                    item.className = "legend-item";
                    const colorBox = document.createElement("span");
                    colorBox.className = "legend-color";
                    colorBox.style.background = "#" + color.toString(16).padStart(6, "0");
                    const text = document.createElement("span");
                    text.textContent = name;
                    item.appendChild(colorBox);
                    item.appendChild(text);
                    legendEl.appendChild(item);

                    const lanePreferredSeed = (Math.random() - 0.5) * 1.0;

                    horses.push({
                        name,
                        mesh,
                        labelSprite,
                        color,
                        laneIndex,
                        laneBaseOffset,
                        laneOffset,
                        lanePreferredSeed,
                        progress: 0,
                        basePPrev: 0,
                        theta: thetaStart,
                        radial,
                        lastYaw: mesh.rotation.y,
                        forward: null,
                        legendItem: item
                    });
                });

                durations = new Array(horses.length).fill(0);
                phases = horses.map(() => Math.random() * Math.PI * 2);

                startBtn.disabled = false;
                updateLegendOrder();
            }

            function startCountdown() {
                if (running || countdownActive) return;

                countdownActive = true;
                let count = 3;
                resultEl.textContent = `⏱ ${count}...`;

                const timer = setInterval(() => {
                    count--;
                    if (count > 0) {
                        resultEl.textContent = `⏱ ${count}...`;
                    } else {
                        clearInterval(timer);
                        countdownActive = false;
                        resultEl.textContent = "🏁 출발!";
                        setTimeout(() => {
                            resultEl.textContent = "";
                        }, 800);
                        beginRace();
                    }
                }, 1000);
            }

            function startRace() {
                if (running || countdownActive || introActive) return;

                if (!horses.length) {
                    setupRace();
                }

                const names = parseNames();
                if (!names.length) {
                    alert("참가자를 한 명 이상 입력해 주세요.");
                    return;
                }

                namesTextarea.disabled = true;
                shuffleBtn.disabled = true;

                raceFinished = false;
                resultEl.textContent = "";
                startBtn.disabled = true;

                introActive = true;
                introStartTime = performance.now();

                setTimeout(() => {
                    if (!introActive || running) return;
                    introActive = false;
                    startCountdown();
                }, 3000);
            }
            function chooseFinalContestCount(n) {
                if (n <= 2) return n;
                const r = Math.random();
                if (r < 0.15) {
                    return Math.min(2, n);
                }
                let maxGroupRaw = Math.floor(n * 0.4);
                let maxGroup = Math.min(n, Math.max(3, maxGroupRaw));
                if (maxGroup <= 2) {
                    return Math.min(2, n);
                }
                const minGroup = 3;
                let weights = [];
                let totalW = 0;
                for (let k = minGroup; k <= maxGroup; k++) {
                    const w = (maxGroup - k + 1);
                    weights.push({ k, w });
                    totalW += w;
                }
                let t = Math.random() * totalW;
                for (let i = 0; i < weights.length; i++) {
                    const { k, w } = weights[i];
                    if (t < w) return k;
                    t -= w;
                }
                return maxGroup;
            }

            function setupContestPattern() {
                contestWindows = [];
                if (!horses.length || raceTotalTime <= 0) return;

                const n = horses.length;
                const totalSec = raceTotalTime / 1000;

                const finalIndices = [];
                for (let i = 0; i < n; i++) finalIndices.push(i);
                for (let i = finalIndices.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    const tmp = finalIndices[i];
                    finalIndices[i] = finalIndices[j];
                    ;
                }

                /*let finalCountRand = Math.random();
                let finalCount = 2;
                if (finalCountRand < 0.5) finalCount = 2;
                else if (finalCountRand < 0.85) finalCount = 3;
                else finalCount = 4;
                if (finalCount > n) finalCount = n;*/
                let finalCount = chooseFinalContestCount(n); //시작부터 승자 정할거면 위 주석이랑 바꾸기

                const finalGroup = finalIndices.slice(0, finalCount);

                let startSec = totalSec * (0.55 + Math.random() * 0.2);
                let endSec = startSec + (3 + Math.random() * 3);
                if (endSec > totalSec * 0.95) endSec = totalSec * 0.95;
                if (endSec < startSec + 1.5) endSec = startSec + 1.5;

                contestWindows.push({
                    start: startSec * 1000,
                    end: endSec * 1000,
                    indices: finalGroup,
                    isFinal: true,
                    intensity: 1.7
                });

                const microCount = 5 + Math.floor(Math.random() * 8);
                for (let k = 0; k < microCount; k++) {
                    const microLenSec = 0.9 + Math.random() * 1.8;
                    const startFactor = 0.1 + Math.random() * 0.55;
                    let startTime = raceTotalTime * startFactor;
                    let endTime = startTime + microLenSec * 1000;
                    const maxEndMicro = raceTotalTime * 0.9;
                    if (endTime > maxEndMicro) endTime = maxEndMicro;
                    if (endTime < startTime + 400) continue;

                    let mCnt = 2 + Math.floor(Math.random() * 3);
                    if (mCnt > n) mCnt = n;

                    const pool = [];
                    for (let i = 0; i < n; i++) pool.push(i);
                    for (let i = pool.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        const tmp = pool[i];
                        pool[i] = pool[j];
                        pool[j] = tmp;
                    }
                    const microIndices = pool.slice(0, mCnt);

                    contestWindows.push({
                        start: startTime,
                        end: endTime,
                        indices: microIndices,
                        isFinal: false,
                        intensity: 1.15
                    });
                }
            }

            function beginRace() {
                if (!horses.length) return;

                raceTotalTime = BASE_MIN_DURATION + Math.random() * (BASE_MAX_DURATION - BASE_MIN_DURATION);

                winnerIndex = null;
                raceFinished = false;

                durations = horses.map(() => {
                    let base = raceTotalTime * (0.95 + Math.random() * 0.1);
                    base *= 1 + (Math.random() * 0.16 - 0.08);
                    return base;
                });

                horses.forEach((h) => {
                    h.progress = 0;
                    h.basePPrev = 0;
                    h.laneOffset = h.laneBaseOffset;

                    const pos = getTrackPosition(thetaStart, h.laneOffset, 0.35);
                    h.mesh.position.copy(pos);
                    const futurePos = getTrackPosition(thetaStart - 0.01, h.laneOffset, 0.35);
                    setHorseOrientation(h, pos, futurePos);

                    const radial = new THREE.Vector3(pos.x, 0, pos.z);
                    if (radial.lengthSq() > 0.0001) radial.normalize();
                    h.radial = radial;
                    h.theta = thetaStart;
                });

                setupContestPattern();

                raceStartTime = performance.now();
                running = true;
            }

            function updateRace(time) {
                if (!running) return;

                if (raceFinished) {
                    if (winnerIndex == null || !horses[winnerIndex]) {
                        running = false;
                        return;
                    }
                    const decelT = clamp((time - postFinishStartTime) / POST_FINISH_DURATION, 0, 1);
                    const extra = POST_FINISH_EXTRA_PROGRESS * (1 - (1 - decelT) * (1 - decelT));

                    const winner = horses[winnerIndex];

                    const startP = winnerFinishProgress;
                    const p = clamp(startP + extra, startP, startP + POST_FINISH_EXTRA_PROGRESS + 0.02);
                    winner.progress = p;

                    const angle = TWO_PI * p;
                    const theta = thetaStart - angle;
                    const pos = getTrackPosition(theta, winner.laneOffset || 0, 0.35);

                    const futureP = Math.min(p + 0.01, p + 0.03);
                    const futureAngle = TWO_PI * futureP;
                    const futureTheta = thetaStart - futureAngle;
                    const futurePos = getTrackPosition(futureTheta, winner.laneOffset || 0, 0.35);

                    setHorseOrientation(winner, pos, futurePos);
                    winner.mesh.position.copy(pos);

                    const radial = new THREE.Vector3(pos.x, 0, pos.z);
                    if (radial.lengthSq() > 0.0001) radial.normalize();
                    winner.radial = radial;
                    winner.theta = theta;

                    if (decelT >= 1) {
                        running = false;
                    }
                    return;
                }

                const elapsed = time - raceStartTime;
                const globalT = clamp(elapsed / (raceTotalTime || 1), 0, 1);

                const prevProgresses = horses.map(h => h.progress || 0);

                let activeContestIndices = [];
                const contestIntensity = new Array(horses.length).fill(1);
                const isContestHorse = new Array(horses.length).fill(false);
                let contestMeanPrev = 0;
                let useContestMean = false;

                contestWindows.forEach(w => {
                    if (elapsed >= w.start && elapsed <= w.end) {
                        const idxList = w.indices || [];
                        for (let i = 0; i < idxList.length; i++) {
                            const hi = idxList[i];
                            if (hi >= 0 && hi < horses.length) {
                                activeContestIndices.push(hi);
                            }
                        }
                    }
                });

                if (activeContestIndices.length > 1) {
                    activeContestIndices = Array.from(new Set(activeContestIndices));
                    let sum = 0;
                    activeContestIndices.forEach(i => {
                        isContestHorse[i] = true;
                        sum += prevProgresses[i];
                    });
                    contestMeanPrev = sum / activeContestIndices.length;
                    useContestMean = true;

                    contestWindows.forEach(w => {
                        if (elapsed >= w.start && elapsed <= w.end) {
                            const intensity = typeof w.intensity === "number" ? w.intensity : 1.1;
                            const idxList = w.indices || [];
                            for (let i = 0; i < idxList.length; i++) {
                                const hi = idxList[i];
                                if (hi >= 0 && hi < horses.length) {
                                    if (intensity > contestIntensity[hi]) {
                                        contestIntensity[hi] = intensity;
                                    }
                                }
                            }
                        }
                    });
                }

                const basePs = new Array(horses.length);
                const newProgresses = new Array(horses.length);
                let finishCandidateIndex = -1;

                let bestAngle = -Infinity;
                let worstAngle = Infinity;

                const n = horses.length;
                const currentLanes = horses.map(h => typeof h.laneOffset === "number" ? h.laneOffset : h.laneBaseOffset);
                const radialForces = new Array(n).fill(0);
                const minSpacing = 0.8;
                const arcThreshold = 0.04;

                for (let i = 0; i < n; i++) {
                    for (let j = i + 1; j < n; j++) {
                        let du = Math.abs(prevProgresses[i] - prevProgresses[j]);
                        if (du > 0.5) du = 1 - du;
                        if (du > arcThreshold) continue;
                        const laneI = currentLanes[i];
                        const laneJ = currentLanes[j];
                        const dr = laneI - laneJ;
                        if (Math.abs(dr) >= minSpacing) continue;

                        const behindIdx = prevProgresses[i] < prevProgresses[j] ? i : j;
                        const aheadIdx = behindIdx === i ? j : i;

                        const laneBehind = currentLanes[behindIdx];
                        const laneAhead = currentLanes[aheadIdx];

                        let sign;
                        if (laneBehind >= laneAhead) sign = 1;
                        else sign = -1;

                        const strength = (minSpacing - Math.abs(dr)) / minSpacing;
                        radialForces[behindIdx] += sign * strength;
                        radialForces[aheadIdx] -= sign * strength * 0.3;
                    }
                }

                const rankIndices = new Array(n);
                if (n > 1) {
                    const progPairs = [];
                    for (let i = 0; i < n; i++) {
                        const prog = prevProgresses[i] || 0;
                        progPairs.push({ idx: i, prog });
                    }
                    progPairs.sort((a, b) => b.prog - a.prog);
                    progPairs.forEach((p, rank) => {
                        rankIndices[p.idx] = rank;
                    });
                }

                horses.forEach((h, idx) => {
                    const dur = durations[idx] || raceTotalTime || 1;
                    const baseP = elapsed / dur;
                    basePs[idx] = baseP;

                    let deltaBase = baseP - (h.basePPrev || 0);
                    if (deltaBase < 0) deltaBase = 0;
                    h.basePPrev = baseP;

                    let noiseAmp;
                    if (globalT < 0.7) noiseAmp = 0.2;
                    else noiseAmp = 0.2 + 0.15 * ((globalT - 0.7) / 0.3);
                    noiseAmp = clamp(noiseAmp, 0, 0.35);

                    const tN = time * 0.001 + phases[idx];
                    let baseNoise = Math.sin(tN * 1.4) * 0.45 + Math.sin(tN * 0.8 + idx) * 0.35;
                    baseNoise = clamp(baseNoise, -1, 1);
                    let noiseMul = noiseAmp * baseNoise;

                    let speedMult = 1 + noiseMul;

                    if (useContestMean && isContestHorse[idx]) {
                        const intensity = contestIntensity[idx] || 1;
                        const diff = contestMeanPrev - prevProgresses[idx];
                        const pull = clamp(diff * 2.0 * intensity, -0.45 * intensity, 0.45 * intensity);
                        speedMult *= 1 + pull;

                        const tLocal = time * 0.001 + phases[idx] * 0.7;
                        const wiggle = Math.sin(tLocal * 4) * 0.08 * intensity;
                        speedMult *= 1 + wiggle;
                    }

                    const laneForAdv = (typeof h.laneOffset === "number" ? h.laneOffset : h.laneBaseOffset);
                    const laneRatio = clamp((laneForAdv + trackWidth / 2) / Math.max(trackWidth, 0.001), 0, 1);
                    const innerFactor = 1 - laneRatio;

                    const thetaCorner = thetaStart - TWO_PI * (prevProgresses[idx] || 0);
                    const cornerAmountSpeed = Math.pow(Math.abs(Math.cos(thetaCorner)), 4);
                    const cornerSpeedBonus = 0.9 + cornerAmountSpeed * innerFactor * 0.15; //코너값

                    speedMult *= cornerSpeedBonus;

                    if (n > 1 && typeof rankIndices[idx] === "number") {
                        const rank = rankIndices[idx];
                        if (rank > 0) {
                            const place = rank + 1;
                            const maxPlace = n;
                            const denom = Math.max(maxPlace - 2, 1);
                            const rank01 = denom > 0 ? (place - 2) / denom : 0;
                            const maxAdvEnd = 0.28; //후방이득값
                            const secondAdvEnd = 0.06;
                            const baseEnd = secondAdvEnd + (maxAdvEnd - secondAdvEnd) * clamp(rank01, 0, 1);
                            const stepFactor = Math.floor(globalT * 10) / 10;
                            const advNow = baseEnd * clamp(stepFactor, 0, 1);
                            //const advNow = baseEnd * clamp(globalT, 0, 1);
                            speedMult *= 1 + advNow;
                        }
                    }

                    speedMult = clamp(speedMult, 0.4, 2.0);

                    const prevP = prevProgresses[idx];
                    const pCandidate = prevP + deltaBase * speedMult;
                    let p = pCandidate;
                    if (p > 1.0) p = 1.0;
                    if (p < prevP) p = prevP;
                    if (pCandidate >= 1.0 && finishCandidateIndex === -1) {
                        finishCandidateIndex = idx;
                    }
                    newProgresses[idx] = p;
                });

                                const innerBase = -trackWidth / 2 + 0.8;
                const clampMinLane = -trackWidth / 2 + 0.4;
                const clampMaxLane = trackWidth / 2 - 0.4;

                horses.forEach((h, idx) => {
                    const p = newProgresses[idx];
                    const baseP = basePs[idx];

                    h.progress = p;
                    h.basePPrev = baseP;

                    const thetaCandidate = thetaStart - TWO_PI * p;
                    const cornerAmount = Math.pow(Math.abs(Math.cos(thetaCandidate)), 4);

                    const laneIndex = h.laneIndex;
                    const baseLane = h.laneBaseOffset;
                    const innerLaneBase = innerBase + laneIndex * (laneGap * 0.8);
                    const tInwardBase = clamp(globalT * 1.1, 0, 1);
                    const tInwardCorner = cornerAmount * 0.45;
                    const tInward = clamp(tInwardBase + tInwardCorner, 0, 1);
                    const targetLaneBase = baseLane * (1 - tInward) + innerLaneBase * tInward;

                    const radialRepel = radialForces[idx] * 0.6;

                    let desiredLane = targetLaneBase + radialRepel;
                    desiredLane = clamp(desiredLane, clampMinLane, clampMaxLane);
                    let hasInnerNeighbor = false;
                    const myLane = currentLanes[idx];
                    const myProg = prevProgresses[idx];

                    for (let j = 0; j < n; j++) {
                        if (j === idx) continue;
                        const dp = Math.abs(prevProgresses[j] - myProg);
                        const arcDist = dp > 0.5 ? 1 - dp : dp;
                        if (arcDist > 0.08) continue;
                        if (currentLanes[j] < myLane) {
                            hasInnerNeighbor = true;
                            break;
                        }
                    }
                    if (!hasInnerNeighbor) {
                        desiredLane -= 0.35;
                    }
                    if (typeof h.laneOffset !== "number") h.laneOffset = h.laneBaseOffset;

                    const baseSmooth = 0.10 + 0.16 * globalT;
                    const cornerBoost = 0.20 * cornerAmount;
                    const smoothFactor = baseSmooth + cornerBoost;

                    h.laneOffset += (desiredLane - h.laneOffset) * smoothFactor;

                    const y = 0.35 + Math.sin(time * 0.004 + phases[idx]) * 0.10;
                    const theta = thetaCandidate;
                    const pos = getTrackPosition(theta, h.laneOffset, y);

                    const futureP = clamp(p + 0.01, 0, 1.05);
                    const futureTheta = thetaStart - TWO_PI * futureP;
                    const futurePos = getTrackPosition(futureTheta, h.laneOffset, y);
                    setHorseOrientation(h, pos, futurePos);

                    h.mesh.position.copy(pos);

                    const radial = new THREE.Vector3(pos.x, 0, pos.z);
                    if (radial.lengthSq() > 0.0001) radial.normalize();
                    h.radial = radial;
                    h.theta = theta;

                    const angleFromStart = (thetaStart - theta + TWO_PI) % TWO_PI;
                    if (angleFromStart > bestAngle) {
                        bestAngle = angleFromStart;
                        leaderIndex = idx;
                    }
                    if (angleFromStart < worstAngle) {
                        worstAngle = angleFromStart;
                        lastIndex = idx;
                    }
                });

                if (horses.length > 0) {
                    const newLeader = leaderIndex;
                    if (newLeader !== cameraLeaderIndex) {
                        const curIdx = clamp(cameraLeaderIndex, 0, horses.length - 1);
                        const cur = horses[curIdx];
                        const nxt = horses[newLeader];
                        if (cur && nxt) {
                            const curTheta = typeof cur.theta === "number" ? cur.theta : thetaStart;
                            const nxtTheta = typeof nxt.theta === "number" ? nxt.theta : thetaStart;
                            const curProg = (thetaStart - curTheta + TWO_PI) % TWO_PI;
                            const nxtProg = (thetaStart - nxtTheta + TWO_PI) % TWO_PI;
                            const diffProg = nxtProg - curProg;
                            const dt = time - lastCameraLeaderSwitchTime;
                            if (diffProg > 0.03 || dt > 800) {
                                cameraLeaderIndex = newLeader;
                                lastCameraLeaderSwitchTime = time;
                            }
                        } else {
                            cameraLeaderIndex = newLeader;
                            lastCameraLeaderSwitchTime = time;
                        }
                    }
                }

                if (!raceFinished && finishCandidateIndex !== -1) {
                    finishRace(finishCandidateIndex, time);
                    return;
                }
            }

            function finishRace(winnerIdx, time) {
                if (raceFinished) return;
                raceFinished = true;
                winnerIndex = winnerIdx;
                postFinishStartTime = time;

                const winner = horses[winnerIndex];
                if (winner) {
                    winnerFinishProgress = 1.0;
                    resultEl.innerHTML =
                        `<span>우승:</span> <span class="winner">🏆 ${winner.name}</span>`;
                    winner.mesh.scale.set(1.3, 1.3, 1.3);
                }
                startBtn.disabled = false;
                startBtn.textContent = "다시 하기";
                shuffleBtn.disabled = false;
            }

            function getLeaderHorse() {
                if (!horses.length) return null;
                return horses[clamp(cameraLeaderIndex, 0, horses.length - 1)];
            }

            function followLeaderCamera() {
                const h = getLeaderHorse();
                if (!h) return;

                const pos = h.mesh.position.clone();
                const radial = h.radial || new THREE.Vector3(pos.x, 0, pos.z).normalize();

                const sideDist = 7.0;
                const height = 3.0;

                const camPos = pos.clone()
                    .add(radial.clone().multiplyScalar(sideDist))
                    .add(new THREE.Vector3(0, height, 0));

                camera.position.lerp(camPos, 0.12);
                camera.lookAt(pos.clone().add(new THREE.Vector3(0, 1.0, 0)));
            }

            function frontLeaderCamera() {
                const h = getLeaderHorse();
                if (!h) return;

                const pos = h.mesh.position.clone();
                let forward = h.forward;
                if (!forward || forward.lengthSq() < 1e-6) {
                    const radial = h.radial || new THREE.Vector3(pos.x, 0, pos.z).normalize();
                    forward = new THREE.Vector3(-radial.z, 0, radial.x);
                }
                forward = forward.clone().normalize();

                const distAhead = 9.0;
                const height = 3.5;

                const camPos = pos.clone()
                    .add(forward.clone().multiplyScalar(distAhead))
                    .add(new THREE.Vector3(0, height, 0));

                camera.position.lerp(camPos, 0.12);
                camera.lookAt(pos.clone().add(new THREE.Vector3(0, 1.2, 0)));
            }

            function aerialAllHorsesCamera() {
                if (!horses.length) return;

                let center = new THREE.Vector3(0, 0, 0);
                horses.forEach(h => center.add(h.mesh.position));
                center.multiplyScalar(1 / horses.length);

                let maxDist = 0;
                horses.forEach(h => {
                    const d = h.mesh.position.distanceTo(center);
                    if (d > maxDist) maxDist = d;
                });

                const height = Math.max(14, maxDist * 1.7);
                const forwardOffset = maxDist * 0.4;

                const camPos = center.clone().add(new THREE.Vector3(0, height, forwardOffset));
                camera.position.lerp(camPos, 0.12);
                camera.lookAt(center.clone().add(new THREE.Vector3(0, 1.0, 0)));
            }

            function winnerCloseUpCamera() {
                if (!horses.length || winnerIndex == null) return;
                const h = horses[winnerIndex] || horses[0];

                const pos = h.mesh.position.clone();
                let forward = h.forward;
                if (!forward || forward.lengthSq() < 1e-6) {
                    const radial = h.radial || new THREE.Vector3(pos.x, 0, pos.z).normalize();
                    forward = new THREE.Vector3(-radial.z, 0, radial.x);
                }
                forward = forward.clone().normalize();

                const side = new THREE.Vector3(-forward.z, 0, forward.x).normalize();

                const distFront = 4.0;
                const sideOffset = 1.8;
                const height = 2.2;

                const camPos = pos.clone()
                    .add(forward.clone().multiplyScalar(distFront))
                    .add(side.clone().multiplyScalar(sideOffset))
                    .add(new THREE.Vector3(0, height, 0));

                camera.position.lerp(camPos, 0.18);
                camera.lookAt(pos.clone().add(new THREE.Vector3(0, 1.5, 0)));
            }

            function updateCamera(time) {
                if (introActive && horses.length) {
                    const totalIntro = 3000;
                    const groupShotDuration = 800;
                    const now = time;
                    const elapsedIntro = Math.max(0, now - introStartTime);
                    const singlePhase = Math.max(0, totalIntro - groupShotDuration);

                    if (elapsedIntro >= totalIntro || singlePhase <= 0) {
                        // fallback to group front view
                        if (horses.length) {
                            let center = new THREE.Vector3(0, 0, 0);
                            horses.forEach(h => center.add(h.mesh.position));
                            center.multiplyScalar(1 / horses.length);

                            let forward = horses[0].forward;
                            if (!forward || forward.lengthSq() < 1e-6) {
                                const radial = horses[0].radial || new THREE.Vector3(center.x, 0, center.z).normalize();
                                forward = new THREE.Vector3(-radial.z, 0, radial.x);
                            }
                            forward.normalize();

                            const spread = trackWidth || 3;
                            const distAhead = Math.max(6.0, spread * 1.8);
                            const height = 3.5;

                            const camPos = center.clone()
                                .add(forward.clone().multiplyScalar(distAhead))
                                .add(new THREE.Vector3(0, height, 0));

                            camera.position.lerp(camPos, 0.15);
                            camera.lookAt(center.clone().add(new THREE.Vector3(0, 1.4, 0)));
                        }
                        return;
                    }

                    if (elapsedIntro >= singlePhase) {
                        // group front shot
                        let center = new THREE.Vector3(0, 0, 0);
                        horses.forEach(h => center.add(h.mesh.position));
                        center.multiplyScalar(1 / horses.length);

                        let forward = horses[0].forward;
                        if (!forward || forward.lengthSq() < 1e-6) {
                            const radial = horses[0].radial || new THREE.Vector3(center.x, 0, center.z).normalize();
                            forward = new THREE.Vector3(-radial.z, 0, radial.x);
                        }
                        forward.normalize();

                        const spread = trackWidth || 3;
                        const distAhead = Math.max(6.5, spread * 2.0);
                        const height = 3.8;

                        const camPos = center.clone()
                            .add(forward.clone().multiplyScalar(distAhead))
                            .add(new THREE.Vector3(0, height, 0));

                        camera.position.lerp(camPos, 0.18);
                        camera.lookAt(center.clone().add(new THREE.Vector3(0, 1.5, 0)));
                        return;
                    }

                    const perHorse = singlePhase / horses.length;
                    let index = Math.floor(elapsedIntro / perHorse);
                    if (index < 0) index = 0;
                    if (index >= horses.length) index = horses.length - 1;

                    const h = horses[index];
                    const pos = h.mesh.position.clone();

                    let forward = h.forward;
                    if (!forward || forward.lengthSq() < 1e-6) {
                        const radial = h.radial || new THREE.Vector3(pos.x, 0, pos.z).normalize();
                        forward = new THREE.Vector3(-radial.z, 0, radial.x);
                    }
                    forward.normalize();

                    const distAhead = 5.0;
                    const height = 2.5;

                    const camPos = pos.clone()
                        .add(forward.clone().multiplyScalar(distAhead))
                        .add(new THREE.Vector3(0, height, 0));

                    camera.position.lerp(camPos, 0.2);
                    camera.lookAt(pos.clone().add(new THREE.Vector3(0, 1.5, 0)));
                    return;
                }

                if (countdownActive && horses.length) {
                    let center = new THREE.Vector3(0, 0, 0);
                    horses.forEach(h => center.add(h.mesh.position));
                    center.multiplyScalar(1 / horses.length);

                    let forward = horses[0].forward;
                    if (!forward || forward.lengthSq() < 1e-6) {
                        const radial = horses[0].radial || new THREE.Vector3(center.x, 0, center.z).normalize();
                        forward = new THREE.Vector3(-radial.z, 0, radial.x);
                    }
                    forward.normalize();

                    const spread = trackWidth || 3;
                    const distAhead = Math.max(7.0, spread * 2.2);
                    const height = 4.2;

                    const camPos = center.clone()
                        .add(forward.clone().multiplyScalar(distAhead))
                        .add(new THREE.Vector3(0, height, 0));

                    camera.position.lerp(camPos, 0.16);
                    camera.lookAt(center.clone().add(new THREE.Vector3(0, 1.6, 0)));
                    return;
                }

                if (raceFinished && horses.length) {
                    winnerCloseUpCamera();
                    return;
                }

                if (running && horses.length) {
                    const elapsed = time - raceStartTime;
                    const rt = clamp(elapsed / (raceTotalTime || 1), 0, 1);

                    let mode = "follow";

                    if (rt < 0.20) mode = "front";
                    else if (rt < 0.40) mode = "follow";
                    else if (rt < 0.58) mode = "aerial";
                    else if (rt < 0.78) mode = "front";
                    else mode = "follow";

                    if (mode === "front") frontLeaderCamera();
                    else if (mode === "aerial") aerialAllHorsesCamera();
                    else followLeaderCamera();

                    return;
                }

                const maxScale = Math.max(ellipseScaleX, ellipseScaleZ);
                const worldR = (trackRadius + trackWidth) * maxScale;
                const halfFovRad = camera.fov * Math.PI / 180 * 0.5;
                const sinHalf = Math.sin(halfFovRad) || 0.5;
                const dist = worldR / sinHalf;
                const height = worldR * 0.6;
                const z = dist * 0.8;

                const idlePos = new THREE.Vector3(0, height, z);
                camera.position.lerp(idlePos, 0.08);
                camera.lookAt(new THREE.Vector3(0, 0, 0));
            }
            function animate(time) {
                requestAnimationFrame(animate);
                if (!renderer || !camera) return;

                onResize();

                if (running) {
                    updateRace(time);
                }
                updateCamera(time);
                updateLegendOrder();

                renderer.render(scene, camera);
            }

            shuffleBtn.addEventListener("click", () => {
                if (running || countdownActive || introActive) return;
                const names = parseNames();
                if (names.length <= 1) return;
                for (let i = names.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    const tmp = names[i];
                    names[i] = names[j];
                    names[j] = tmp;
                }
                namesTextarea.value = names.join("\n");
                setupRace();
            });

            startBtn.addEventListener("click", () => {
                if (raceFinished && !running) {
                    namesTextarea.disabled = false;
                    startBtn.textContent = "경주 시작";
                    shuffleBtn.disabled = false;
                    setupRace();
                    return;
                }
                startRace();
            });

            initThree();
            setupRace();

            namesTextarea.addEventListener("input", () => {
                if (!running && !countdownActive) {
                    setupRace();
                }
            });
        })();
