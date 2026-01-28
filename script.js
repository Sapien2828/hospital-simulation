// script.js - 保留ログ記録修正版・完全統合

// ★ここに発行されたGASのWebアプリURLを設定
const GAS_URL = "https://script.google.com/macros/s/AKfycbyXuTtcIgO5lDPDs_PU24VTb3L29cL-2uB-oeruNDqrYclDerB_9TA9p23-zX1csDz1OQ/exec";

// DOM要素
const topScreen = document.getElementById('top-screen');
const gameWrapper = document.getElementById('game-wrapper');
const canvas = document.getElementById('map-canvas');
const ctx = canvas.getContext('2d');
const eventPopup = document.getElementById('event-popup');
const statusDiv = document.getElementById('status-message'); 
const debugCoords = document.getElementById('coord-display');
const resultScreen = document.getElementById('result-screen');
const resultLogBody = document.getElementById('result-log-body');
const finishPracticeBtn = document.getElementById('btn-finish-practice');
const playerIdInput = document.getElementById('player-id-input');
const adminLoginOverlay = document.getElementById('admin-login-overlay');
const adminPassInput = document.getElementById('admin-pass-input');
const adminScreen = document.getElementById('admin-screen');
const adminLogBody = document.getElementById('admin-log-body');

const collisionCanvas = document.createElement('canvas');
const collisionCtx = collisionCanvas.getContext('2d');

// ゲーム状態
const GAME_LIMIT_MINUTES = 30; 
let elapsedTime = 0; 
let isGameOver = false; 
let actionLogs = []; 
let currentMode = ''; 
let playerID = "guest"; 

const GRID_SIZE = 5; 
let gridMap = []; let cols = 0; let rows = 0;
let lastTriggeredRoomIndex = -1;

const player = { x: 761, y: 461, moving: false, speed: 4, radius: 12, path: [] };
let roomData = []; 

// 画像読み込み
const mapImg = new Image();
const collisionImg = new Image();
let mapLoaded = false; let collisionLoaded = false; let csvLoaded = false;

mapImg.src = "display.jpg";
collisionImg.src = "map_collision.jpg";

mapImg.onload = () => { mapLoaded = true; };
mapImg.onerror = () => { alert("display.jpgが見つかりません"); };
collisionImg.onload = () => { collisionLoaded = true; };
collisionImg.onerror = () => { console.warn("map_collision.jpgなし"); collisionLoaded = true; };

// --- スタート処理 ---
window.startGame = function(mode) {
    const inputVal = playerIdInput.value.trim();
    
    if (mode === 'training') {
        if (!inputVal) {
            alert("訓練モードでは「職員ID または 氏名」の入力が必須です。");
            return;
        }
        playerID = inputVal;
    } else {
        playerID = inputVal ? inputVal : "practice_guest";
    }

    currentMode = mode;
    topScreen.style.display = 'none';
    gameWrapper.style.display = 'flex';
    
    const statusTitle = document.getElementById('status-title');
    const barFill = document.getElementById('timer-bar-fill');
    
    if (currentMode === 'practice') {
        finishPracticeBtn.style.display = 'block';
        statusTitle.textContent = `🔰 練習モード (ID: ${playerID})`;
        statusTitle.style.color = "#8f8";
        barFill.style.background = "#00aa00";
        barFill.style.width = "100%";
    } else {
        finishPracticeBtn.style.display = 'none';
        statusTitle.textContent = `🔥 発災訓練モード (ID: ${playerID})`;
        statusTitle.style.color = "#ff8";
    }
    loadCSVData();
};

function checkInit() {
    if (mapLoaded && csvLoaded && collisionLoaded) {
        canvas.width = mapImg.width; canvas.height = mapImg.height;
        collisionCanvas.width = mapImg.width; collisionCanvas.height = mapImg.height;
        initGridMap();
        updateTimeDisplay();
        requestAnimationFrame(gameLoop);
    }
}

// --- 壁マップ ---
function initGridMap() {
    if (collisionImg.complete && collisionImg.naturalWidth > 0) collisionCtx.drawImage(collisionImg, 0, 0);
    cols = Math.ceil(canvas.width / GRID_SIZE); rows = Math.ceil(canvas.height / GRID_SIZE);
    gridMap = new Array(cols).fill(0).map(() => new Array(rows).fill(0));
    const imgData = collisionCtx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            let isWall = false;
            checkLoop: for (let dy = 0; dy < GRID_SIZE; dy+=2) {
                for (let dx = 0; dx < GRID_SIZE; dx+=2) {
                    const px = x * GRID_SIZE + dx; const py = y * GRID_SIZE + dy;
                    if (px < canvas.width && py < canvas.height) {
                        const index = (py * canvas.width + px) * 4;
                        if ((imgData[index] + imgData[index+1] + imgData[index+2]) / 3 < 80) { isWall = true; break checkLoop; }
                    }
                }
            }
            if (isWall) gridMap[x][y] = 1; 
        }
    }
}

// --- CSV読み込み ---
async function loadCSVData() {
    try {
        const response = await fetch(`data.csv?t=${Date.now()}`);
        const buffer = await response.arrayBuffer();
        let text = "";
        try { const decoder = new TextDecoder('utf-8', { fatal: true }); text = decoder.decode(buffer); } 
        catch(e) { const decoder = new TextDecoder('sjis'); text = decoder.decode(buffer); }
        const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
        const roomsMap = {};
        for (let i = 1; i < lines.length; i++) {
            let line = lines[i].replace(/\t/g, ',');
            const c = line.split(',');
            if (c.length < 5) continue;
            const no = c[0].trim(); const x = parseInt(c[2]); const y = parseInt(c[3]);
            let radius = parseInt(c[4]);
            if (isNaN(x) || isNaN(y)) continue;
            if (isNaN(radius) || radius < 15) radius = 15;
            if (!roomsMap[no]) {
                roomsMap[no] = { name: c[1], x: x, y: y, radius: radius, discovered: false, description: `${c[1]}に到着しました。`, tasks: [] };
            }
            if (c[5] && c[6]) {
                const task = { id: c[5], title: c[6], detail: c[7] || "", status: 'pending', choices: [] };
                for (let j = 8; j < c.length - 2; j += 3) {
                    if (c[j] && c[j].trim() !== "") {
                        let type = "solve"; if (c[j].match(/保留|断る|後で|無視/)) type = "hold";
                        task.choices.push({ text: c[j], result: c[j+1] || "", time: parseInt(c[j+2]) || 0, type: type });
                    }
                }
                roomsMap[no].tasks.push(task);
            }
        }
        roomData = Object.values(roomsMap);
        csvLoaded = true; checkInit();
    } catch (e) { console.error(e); }
}

// --- クリック判定 ---
canvas.addEventListener('mousedown', (e) => {
    if (isGameOver || document.getElementById('event-popup').style.display === 'block') return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width; const scaleY = canvas.height / rect.height;
    const mouseX = (e.clientX - rect.left) * scaleX; const mouseY = (e.clientY - rect.top) * scaleY;

    for (let i = 0; i < roomData.length; i++) {
        let room = roomData[i];
        if (!room.discovered) continue; 
        
        const allDone = room.tasks.every(t => t.status === 'completed');
        if (allDone) continue; 

        const clickDist = Math.sqrt((mouseX - room.x)**2 + (mouseY - room.y)**2);
        if (clickDist < 30) {
            const playerDist = Math.sqrt((player.x - room.x)**2 + (player.y - room.y)**2);
            if (playerDist < room.radius + 10) { openEventWindow(i); return; }
            else { 
                statusDiv.textContent = `📍 ${room.name} へ移動します...`; statusDiv.style.color = "#0ff";
                findAndMoveToTarget(room.x, room.y); 
                if (lastTriggeredRoomIndex === i) lastTriggeredRoomIndex = -1; 
                return; 
            }
        }
    }
    const gx = Math.floor(mouseX / GRID_SIZE); const gy = Math.floor(mouseY / GRID_SIZE);
    if (gx < 0 || gx >= cols || gy < 0 || gy >= rows) return;
    if (gridMap[gx][gy] === 1) { statusDiv.textContent = "⚠️ そこは壁です"; statusDiv.style.color = "#ffdd55"; return; }
    findAndMoveToTarget(mouseX, mouseY);
});

function findAndMoveToTarget(tx, ty) {
    statusDiv.textContent = "経路計算中..."; statusDiv.style.color = "white";
    const startNode = { x: Math.floor(player.x / GRID_SIZE), y: Math.floor(player.y / GRID_SIZE) };
    const endNode = { x: Math.floor(tx / GRID_SIZE), y: Math.floor(ty / GRID_SIZE) };
    setTimeout(() => {
        const pathNodes = findPathAStar(startNode, endNode);
        if (pathNodes.length > 0) {
            player.path = pathNodes.map(node => ({ x: node.x * GRID_SIZE + GRID_SIZE / 2, y: node.y * GRID_SIZE + GRID_SIZE / 2 }));
            player.moving = true; statusDiv.textContent = "移動中...";
        } else {
            statusDiv.textContent = "⚠️ 到達できません"; statusDiv.style.color = "#ff5555";
        }
    }, 10);
}

function findPathAStar(start, end) {
    const openList = []; const closedList = new Set();
    openList.push({ x: start.x, y: start.y, g: 0, h: 0, f: 0, parent: null });
    let loopLimit = 10000;
    while (openList.length > 0 && loopLimit > 0) {
        loopLimit--; let lowestIndex = 0;
        for(let i=1; i<openList.length; i++) if(openList[i].f < openList[lowestIndex].f) lowestIndex = i;
        let currentNode = openList[lowestIndex];
        if (Math.abs(currentNode.x - end.x) <= 1 && Math.abs(currentNode.y - end.y) <= 1) {
            let path = []; let curr = currentNode; while(curr.parent) { path.push({x: curr.x, y: curr.y}); curr = curr.parent; } return path.reverse();
        }
        openList.splice(lowestIndex, 1); closedList.add(`${currentNode.x},${currentNode.y}`);
        const neighbors = [{x:0, y:-1}, {x:0, y:1}, {x:-1, y:0}, {x:1, y:0}];
        for (let i=0; i<neighbors.length; i++) {
            const neighborX = currentNode.x + neighbors[i].x; const neighborY = currentNode.y + neighbors[i].y;
            if(neighborX < 0 || neighborX >= cols || neighborY < 0 || neighborY >= rows) continue;
            if(gridMap[neighborX][neighborY] === 1) continue; if(closedList.has(`${neighborX},${neighborY}`)) continue;
            const gScore = currentNode.g + 1;
            let neighborNode = openList.find(n => n.x === neighborX && n.y === neighborY);
            if(!neighborNode) {
                neighborNode = { x: neighborX, y: neighborY, g: gScore, h: 0, f: 0, parent: currentNode };
                neighborNode.h = Math.abs(neighborNode.x - end.x) + Math.abs(neighborNode.y - end.y);
                neighborNode.f = neighborNode.g + neighborNode.h; openList.push(neighborNode);
            } else if (gScore < neighborNode.g) {
                neighborNode.g = gScore; neighborNode.parent = currentNode; neighborNode.f = neighborNode.g + neighborNode.h;
            }
        }
    }
    return [];
}

function gameLoop() {
    update(); draw();
    if (!isGameOver) requestAnimationFrame(gameLoop);
}

function update() {
    if (isGameOver) return;
    if (!player.moving) return;
    if (player.path.length > 0) {
        const nextPoint = player.path[0];
        const dx = nextPoint.x - player.x; const dy = nextPoint.y - player.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist < player.speed) {
            player.x = nextPoint.x; player.y = nextPoint.y; player.path.shift();
            elapsedTime += 0.01; updateTimeDisplay();
            checkEventTrigger();
            if (player.path.length === 0) { player.moving = false; statusDiv.textContent = "到着しました"; }
        } else {
            player.x += (dx / dist) * player.speed; player.y += (dy / dist) * player.speed;
            checkEventTrigger();
        }
    } else { player.moving = false; }
}

function checkEventTrigger() {
    let inAnyRoom = false;
    for (let i = 0; i < roomData.length; i++) {
        const r = roomData[i];
        const dist = Math.sqrt((player.x - r.x) ** 2 + (player.y - r.y) ** 2);
        if (dist < r.radius) {
            inAnyRoom = true;
            if (i === lastTriggeredRoomIndex) continue;
            const allDone = r.tasks.every(t => t.status === 'completed');
            if (allDone) continue;
            const hasPending = r.tasks.some(t => t.status === 'pending');
            if (hasPending || !r.discovered) {
                player.moving = false; player.path = [];
                if (!r.discovered) { r.discovered = true; statusDiv.textContent = `📍 ${r.name} を発見！`; }
                openEventWindow(i); lastTriggeredRoomIndex = i; break;
            }
        }
    }
    if (!inAnyRoom) lastTriggeredRoomIndex = -1;
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (mapLoaded) ctx.drawImage(mapImg, 0, 0);
    if (player.path.length > 0) {
        ctx.save(); ctx.beginPath(); ctx.moveTo(player.x, player.y);
        for(let p of player.path) ctx.lineTo(p.x, p.y);
        ctx.strokeStyle = "rgba(0, 255, 0, 0.8)"; ctx.lineWidth = 6; ctx.setLineDash([5, 5]); ctx.lineJoin = "round"; ctx.stroke();
        const dest = player.path[player.path.length - 1]; drawFlag(dest.x, dest.y); ctx.restore();
    }
    ctx.font = "24px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    
    roomData.forEach(r => {
        if (r.discovered) {
            const allDone = r.tasks.every(t => t.status === 'completed');
            if (!allDone) {
                ctx.fillStyle = "red"; ctx.fillText("📍", r.x, r.y);
            }
        }
    });
    ctx.beginPath(); ctx.arc(player.x, player.y, player.radius, 0, Math.PI * 2);
    ctx.fillStyle = "cyan"; ctx.fill(); ctx.strokeStyle = "white"; ctx.lineWidth = 2; ctx.stroke();
}

function drawFlag(x, y) {
    ctx.save(); ctx.translate(x, y); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -25); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -25); ctx.quadraticCurveTo(5, -28, 15, -20); ctx.quadraticCurveTo(5, -12, 0, -15); ctx.fillStyle="blue"; ctx.fill();
    ctx.beginPath(); ctx.moveTo(-3,-2); ctx.lineTo(3,2); ctx.moveTo(3,-2); ctx.lineTo(-3,2); ctx.stroke(); ctx.restore();
}

function updateTimeDisplay() {
    if (isGameOver) return;
    if (currentMode === 'practice') {
        document.getElementById('time-text-overlay').textContent = `経過時間: ${elapsedTime.toFixed(1)} 分`; return; 
    }
    let percent = (elapsedTime / GAME_LIMIT_MINUTES) * 100; if (percent > 100) percent = 100;
    const barFill = document.getElementById('timer-bar-fill');
    barFill.style.width = percent + "%";
    if (percent < 50) barFill.style.background = "linear-gradient(to bottom, #00ffff, #0088ff)";
    else if (percent < 80) barFill.style.background = "linear-gradient(to bottom, #ffff00, #ff8800)";
    else barFill.style.background = "linear-gradient(to bottom, #ff4444, #990000)";
    document.getElementById('time-text-overlay').textContent = `TIME: ${elapsedTime.toFixed(1)} / ${GAME_LIMIT_MINUTES} min`;
    if (elapsedTime >= GAME_LIMIT_MINUTES) finishGame();
}

window.finishGame = function() {
    if (isGameOver) return;
    isGameOver = true; player.moving = false;
    statusDiv.textContent = "シミュレーション終了"; statusDiv.style.color = "red";
    document.getElementById('event-popup').style.display = 'none';
    
    resultLogBody.innerHTML = "";
    actionLogs.forEach(log => {
        const row = document.createElement("tr");
        row.innerHTML = `<td>${log.time.toFixed(1)}分</td><td>${log.realTime}</td><td>${log.location}</td><td>${log.event}</td><td>${log.choice}</td><td>${log.result}</td><td>${log.cost}分</td>`;
        resultLogBody.appendChild(row);
    });
    resultScreen.style.display = "flex";

    saveLogsToLocalStorage();
    if (currentMode === 'training') saveLogsToGoogleSheets();
};

function saveLogsToLocalStorage() {
    if (actionLogs.length === 0) return;
    const now = new Date(); const timestamp = now.toLocaleString();
    const saveItem = { playerID: playerID, mode: currentMode, timestamp: timestamp, logs: actionLogs };
    let allHistory = JSON.parse(localStorage.getItem('simHistory') || "[]");
    allHistory.push(saveItem);
    localStorage.setItem('simHistory', JSON.stringify(allHistory));
}

function saveLogsToGoogleSheets() {
    if (actionLogs.length === 0) return;
    const postData = { playerID: playerID, mode: currentMode, logs: actionLogs };
    fetch(GAS_URL, {
        method: "POST", mode: "no-cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(postData)
    }).then(() => console.log("Sent to GAS")).catch(err => console.error(err));
}

window.downloadCSV = function() {
    let csvContent = `\uFEFF職員ID: ${playerID}\n経過時間,実時刻,場所,イベント,選択した行動,結果,消費時間\n`;
    actionLogs.forEach(log => {
        const row = [log.time.toFixed(1), `"${log.realTime}"`, `"${log.location}"`, `"${log.event}"`, `"${log.choice}"`, `"${log.result}"`, log.cost];
        csvContent += row.join(",") + "\n";
    });
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `result_${playerID}.csv`;
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
};

window.retryGame = function() { location.reload(); };
window.exitGame = function() {
    alert("お疲れさまでした。ブラウザを閉じてください。");
    document.body.innerHTML = "<div style='display:flex;justify-content:center;align-items:center;height:100vh;background:black;color:white;font-size:2em;'>お疲れさまでした。</div>";
};

// --- 管理者機能 ---
window.showAdminLogin = function() { adminLoginOverlay.style.display = 'flex'; };
window.closeAdminLogin = function() { adminLoginOverlay.style.display = 'none'; adminPassInput.value = ""; };
window.checkAdminPass = function() {
    if (adminPassInput.value === 'kanri') { closeAdminLogin(); openAdminScreen(); } else { alert("パスワードが違います"); }
};
function openAdminScreen() {
    adminScreen.style.display = 'flex'; adminLogBody.innerHTML = "";
    const allHistory = JSON.parse(localStorage.getItem('simHistory') || "[]");
    if (allHistory.length === 0) { adminLogBody.innerHTML = "<tr><td colspan='7' style='text-align:center'>ログがありません</td></tr>"; return; }
    allHistory.reverse().forEach(entry => {
        entry.logs.forEach(log => {
            const row = document.createElement("tr");
            row.innerHTML = `<td>${entry.playerID}</td><td>${log.realTime}</td><td>${log.time.toFixed(1)}</td><td>${log.location}</td><td>${log.event}</td><td>${log.choice}</td><td>${log.result}</td>`;
            adminLogBody.appendChild(row);
        });
    });
}
window.closeAdminScreen = function() { adminScreen.style.display = 'none'; };
window.downloadAllLogs = function() {
    const allHistory = JSON.parse(localStorage.getItem('simHistory') || "[]");
    if (allHistory.length === 0) { alert("ログがありません"); return; }
    let csvContent = "\uFEFF職員ID,モード,記録日時,経過時間,実時刻,場所,イベント,選択,結果,消費\n";
    allHistory.forEach(entry => {
        entry.logs.forEach(log => {
            const row = [entry.playerID, entry.mode, entry.timestamp, log.time.toFixed(1), log.realTime, log.location, log.event, log.choice, log.result, log.cost];
            csvContent += row.map(v => `"${v}"`).join(",") + "\n";
        });
    });
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `admin_all_logs_${new Date().getTime()}.csv`;
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
};
window.clearAllLogs = function() {
    if(confirm("全ての保存ログを削除します。よろしいですか？")) { localStorage.removeItem('simHistory'); openAdminScreen(); }
};

// --- イベントウィンドウ ---
function openEventWindow(index) {
    eventPopup.style.display = 'block';
    const room = roomData[index];
    document.getElementById('event-title').textContent = room.name;
    document.getElementById('event-desc').innerHTML = room.description;
    renderTaskList(index);
}

function renderTaskList(roomIndex) {
    const content = document.getElementById('event-content');
    content.innerHTML = "";
    const room = roomData[roomIndex];
    if (room.tasks.every(t => t.status === 'completed')) {
        document.getElementById('event-popup').style.display = 'none';
        statusDiv.textContent = `✅ ${room.name} 対応完了！`; statusDiv.style.color = "#4f4";
        return; 
    }
    room.tasks.forEach((task, taskIndex) => {
        const btn = document.createElement('div');
        btn.className = `task-item ${task.status === 'completed' ? 'completed' : ''}`;
        let icon = task.status === 'completed' ? "✅" : "⚠️";
        btn.innerHTML = `<span>${icon} ${task.title}</span>`;
        if (task.status !== 'completed') btn.onclick = () => showChoices(roomIndex, taskIndex);
        content.appendChild(btn);
    });
    
    // ★保留ボタン（ログ記録機能修正済み）
    const holdBtn = document.createElement("button");
    holdBtn.className = "choice-btn"; holdBtn.style.backgroundColor = "#555"; holdBtn.style.textAlign = "center"; holdBtn.style.marginTop = "15px";
    holdBtn.textContent = "一時保留にする（閉じる）";
    
    holdBtn.onclick = () => { 
        // ログに記録
        const now = new Date();
        const timeStr = `${now.getHours()}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
        
        actionLogs.push({ 
            time: elapsedTime, 
            realTime: timeStr, 
            location: room.name, 
            event: "エリア選択画面", 
            choice: "一時保留にする（閉じる）", 
            result: "対応を後回しにしました", 
            cost: 0 
        });

        document.getElementById('event-popup').style.display = 'none'; 
    };
    
    content.appendChild(holdBtn);
}

function showChoices(roomIndex, taskIndex) {
    const content = document.getElementById('event-content');
    content.innerHTML = "";
    const task = roomData[roomIndex].tasks[taskIndex];
    document.getElementById('event-desc').innerHTML = task.detail;
    task.choices.forEach(choice => {
        const btn = document.createElement('button');
        btn.className = 'choice-btn';
        if (choice.type === 'hold') btn.style.borderLeft = "5px solid orange";
        btn.textContent = `${choice.text} `;
        btn.onclick = () => {
            const now = new Date();
            const timeStr = `${now.getHours()}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
            actionLogs.push({ time: elapsedTime, realTime: timeStr, location: roomData[roomIndex].name, event: task.title, choice: choice.text, result: choice.result, cost: choice.time });
            elapsedTime += choice.time;
            updateTimeDisplay();
            document.getElementById('event-desc').textContent = choice.result;
            if (choice.type === 'solve') task.status = 'completed';
            content.innerHTML = "";
            const okBtn = document.createElement('button');
            okBtn.className = 'choice-btn'; okBtn.textContent = "確認";
            okBtn.onclick = () => {
                const room = roomData[roomIndex];
                if (room.tasks.every(t => t.status === 'completed')) {
                    document.getElementById('event-popup').style.display = 'none';
                    statusDiv.textContent = `✅ ${room.name} 対応完了！`; statusDiv.style.color = "#4f4";
                } else {
                    document.getElementById('event-desc').innerHTML = room.description;
                    renderTaskList(roomIndex);
                }
            };
            content.appendChild(okBtn);
        };
        content.appendChild(btn);
    });
    const back = document.createElement('button');
    back.className = 'choice-btn'; back.style.backgroundColor = '#555';
    back.textContent = "戻る"; back.onclick = () => renderTaskList(roomIndex);
    content.appendChild(back);
}
document.getElementById('close-btn').onclick = () => { document.getElementById('event-popup').style.display = 'none'; };
canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = Math.round((e.clientX - rect.left) * (canvas.width/rect.width));
    const my = Math.round((e.clientY - rect.top) * (canvas.height/rect.height));
    if(debugCoords) debugCoords.textContent = `X:${mx}, Y:${my}`;
});