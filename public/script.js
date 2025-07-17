document.addEventListener('DOMContentLoaded', () => {
    const socket = io(); // Connects to the Socket.IO server

    // UI Elements
    const statusText = document.getElementById('status-text');
    const statusDot = document.getElementById('status-dot');
    const qrContainer = document.getElementById('qr-container');
    const qrImage = document.getElementById('qr-image');
    const logsContainer = document.getElementById('logs');
    const startBtn = document.getElementById('start-btn');
    const resetBtn = document.getElementById('reset-btn');
    const contactsTextarea = document.getElementById('contacts');
    const messageTextarea = document.getElementById('message');

    let isReady = false;
    
    // Initialize button states: Start is disabled, Reset is enabled
    startBtn.disabled = true; 
    resetBtn.disabled = false; // The reset button should always be available

    // --- Helper Functions ---
    function addLog(message) {
        const p = document.createElement('p');
        p.innerHTML = `&gt; ${message.replace(/</g, "&lt;").replace(/>/g, "&gt;")}`;
        logsContainer.appendChild(p);
        logsContainer.scrollTop = logsContainer.scrollHeight; // Auto-scroll
    }

    function updateStatus(text, color) {
        statusText.textContent = text;
        // Tailwind needs the full class name, so we can't just use a variable.
        // Ensure this class is properly applied: e.g., bg-gray-500, bg-yellow-500 etc.
        statusDot.className = `status-dot mr-3 bg-${color}-500`;
    }
    
    function setStartButtonState(enabled) {
        startBtn.disabled = !enabled;
    }

    // --- Socket Event Listeners ---
    socket.on('connect', () => {
        console.log('Connected to server!');
    });

    socket.on('log', (message) => {
        addLog(message);
    });
    
    socket.on('status', (status) => {
        updateStatus(status.message, status.color);
    });

    socket.on('qr', (url) => {
        qrImage.src = url;
        qrContainer.classList.remove('hidden');
        isReady = false;
        setStartButtonState(false); // Disable start button while QR is shown
    });

    socket.on('ready', () => {
        qrContainer.classList.add('hidden');
        isReady = true;
        setStartButtonState(true); // Enable start button when ready
        addLog('✅ System is ready. You can now start the automation.');
    });

    socket.on('disconnect', () => {
        updateStatus('Disconnected', 'red');
        isReady = false;
        setStartButtonState(false); // Disable start button on disconnect
        addLog('❌ Lost connection to the server.');
    });


    // --- User Actions ---
    startBtn.addEventListener('click', () => {
        if (!isReady) {
            addLog('⚠️ Please wait for the client to be ready.');
            return;
        }

        const contactsRaw = contactsTextarea.value.trim();
        const messageTemplate = messageTextarea.value.trim();

        if (!contactsRaw || !messageTemplate) {
            addLog('❌ Error: Contacts and message template cannot be empty.');
            return;
        }

        // Parse CSV contacts
        const contacts = contactsRaw.split('\n').map(line => {
            const [name, phone] = line.split(',').map(item => item.trim());
            return { name, phone };
        }).filter(c => c.name && c.phone);

        if (contacts.length === 0) {
            addLog('❌ Error: No valid contacts found. Check the format (Name,Phone).');
            return;
        }

        setStartButtonState(false); // Disable start button during automation
        socket.emit('start-automation', { contacts, messageTemplate });
    });
    
    resetBtn.addEventListener('click', () => {
        addLog('Requesting session reset...');
        setStartButtonState(false); // Disable start button when resetting
        socket.emit('reset-session');
    });
});