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

    // New Agenda UI Elements
    const tabButtons = document.querySelectorAll('.tab-button');
    const agendaDayContents = document.querySelectorAll('.agenda-day-content');
    const addEventButtons = document.querySelectorAll('.add-event-btn');
    const scheduleAgendaBtn = document.getElementById('schedule-agenda-btn');
    const scheduledEventsSummary = document.getElementById('scheduled-events-summary');
    const eventsList = document.getElementById('events-list');
    // Removed rescanQrBtn as per new requirement

    let isReady = false; // Tracks WhatsApp client readiness
    
    // Initialize button states: Start is disabled, Reset is enabled, Schedule Agenda is disabled
    startBtn.disabled = true; 
    resetBtn.disabled = false; 
    scheduleAgendaBtn.disabled = true; 

    // --- Helper Functions ---
    function addLog(message) {
        const p = document.createElement('p');
        p.innerHTML = `&gt; ${message.replace(/</g, "&lt;").replace(/>/g, "&gt;")}`;
        logsContainer.appendChild(p);
        logsContainer.scrollTop = logsContainer.scrollHeight; // Auto-scroll
    }

    function updateStatus(text, color) {
        statusText.textContent = text;
        statusDot.className = `status-dot mr-3 bg-${color}-500`;
    }
    
    function setStartButtonState(enabled) {
        startBtn.disabled = !enabled;
    }

    function setAgendaScheduleButtonState(enabled) {
        scheduleAgendaBtn.disabled = !enabled;
    }

    // Function to create a new event slot HTML
    function createEventSlotHtml() {
        return `
            <div class="event-slot p-4 border border-gray-200 rounded-lg bg-gray-50">
                <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                    <div>
                        <label class="block text-xs font-medium text-gray-600 mb-1">Date</label>
                        <input type="date" class="event-date w-full p-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500">
                    </div>
                    <div>
                        <label class="block text-xs font-medium text-gray-600 mb-1">Time</label>
                        <input type="time" class="event-time w-full p-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500">
                    </div>
                    <div class="flex items-end">
                        <button class="remove-event-btn w-full bg-red-500 text-white px-3 py-2 rounded-lg text-sm hover:bg-red-600 transition duration-200">Remove</button>
                    </div>
                </div>
                <div>
                    <label class="block text-xs font-medium text-gray-600 mb-1">Message</label>
                    <textarea rows="3" class="event-message w-full p-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500" placeholder="Hey {name}, this is an agenda message!"></textarea>
                </div>
            </div>
        `;
    }

    // Function to attach event listener to remove buttons (for both initial and dynamically added)
    function addRemoveEventButtonListener(button) {
        button.addEventListener('click', (event) => {
            const eventSlot = event.target.closest('.event-slot');
            if (eventSlot) {
                eventSlot.remove();
                addLog('Event slot removed.');
            }
        });
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
        setStartButtonState(false); 
        setAgendaScheduleButtonState(false);
    });

    socket.on('ready', () => {
        qrContainer.classList.add('hidden');
        isReady = true;
        setStartButtonState(true); 
        setAgendaScheduleButtonState(true);
        addLog('✅ WhatsApp client is ready and connected. Messages will be sent as scheduled.');
    });

    socket.on('disconnect', () => {
        updateStatus('Disconnected', 'red');
        isReady = false;
        setStartButtonState(false); 
        setAgendaScheduleButtonState(false);
        addLog('❌ Lost connection to the server. Please check server logs and ensure client is logged in.');
    });

    socket.on('agenda-scheduled-summary', (agenda) => {
        eventsList.innerHTML = ''; // Clear previous list
        if (agenda && agenda.length > 0) {
            agenda.sort((a, b) => new Date(`${a.date}T${a.time}`) - new Date(`${b.date}T${b.time}`)); // Sort by date/time
            agenda.forEach(event => {
                const li = document.createElement('li');
                const eventDateTime = new Date(`${event.date}T${event.time}`);
                const formattedDateTime = eventDateTime.toLocaleString('en-US', { 
                    month: 'short', day: 'numeric', year: 'numeric', 
                    hour: 'numeric', minute: 'numeric', hour12: true 
                });
                li.textContent = `🗓️ ${formattedDateTime} - "${event.message.substring(0, 50)}..."`; // Show first 50 chars
                eventsList.appendChild(li);
            });
            scheduledEventsSummary.classList.remove('hidden'); // Show the summary box
        } else {
            scheduledEventsSummary.classList.add('hidden'); // Hide if no events
        }
    });

    // --- User Actions (Campaign) ---
    startBtn.addEventListener('click', () => {
        if (!isReady) {
            addLog('⚠️ Please wait for the client to be ready before starting automation.');
            return;
        }

        const contactsRaw = contactsTextarea.value.trim();
        const messageTemplate = messageTextarea.value.trim();

        if (!contactsRaw || !messageTemplate) {
            addLog('❌ Error: Contacts and message template cannot be empty for campaign.');
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

        setStartButtonState(false); 
        setAgendaScheduleButtonState(false); 
        addLog('Initiating immediate campaign automation...');
        socket.emit('start-automation', { contacts, messageTemplate });
    });
    
    resetBtn.addEventListener('click', () => {
        addLog('Requesting session reset...');
        setStartButtonState(false); 
        setAgendaScheduleButtonState(false);
        scheduledEventsSummary.classList.add('hidden'); // Hide agenda summary on reset
        eventsList.innerHTML = ''; // Clear agenda summary list
        socket.emit('reset-session');
    });

    // --- User Actions (Agenda) ---

    // Tab switching logic
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const day = button.dataset.day;

            // Remove active class from all buttons
            tabButtons.forEach(btn => btn.classList.remove('active'));
            // Add active class to clicked button
            button.classList.add('active');

            // Hide all agenda content divs
            agendaDayContents.forEach(content => content.classList.add('hidden'));
            // Show the content div for the selected day
            document.getElementById(`${day}-agenda`).classList.remove('hidden');
        });
    });

    // Add Event button logic
    addEventButtons.forEach(button => {
        button.addEventListener('click', (event) => {
            const day = event.target.dataset.day;
            const eventsContainer = document.querySelector(`#${day}-agenda .events-container`);
            const newEventSlotWrapper = document.createElement('div'); // Create a wrapper div
            newEventSlotWrapper.innerHTML = createEventSlotHtml();
            const newEventSlot = newEventSlotWrapper.firstElementChild; // Get the actual event slot div
            eventsContainer.appendChild(newEventSlot);
            addRemoveEventButtonListener(newEventSlot.querySelector('.remove-event-btn')); // Attach listener to the new button
            addLog('New event slot added.');
        });
    });

    // Attach listeners to initial remove buttons
    document.querySelectorAll('.remove-event-btn').forEach(addRemoveEventButtonListener);


    // Schedule Agenda button logic
    scheduleAgendaBtn.addEventListener('click', () => {
        if (!isReady) {
            addLog('⚠️ Please wait for the WhatsApp client to be ready before scheduling agenda.');
            return;
        }

        const contactsRaw = contactsTextarea.value.trim();
        if (!contactsRaw) {
            addLog('❌ Error: Contacts list cannot be empty to schedule agenda messages. Please fill in the contacts section.');
            return;
        }
        const contacts = contactsRaw.split('\n').map(line => {
            const [name, phone] = line.split(',').map(item => item.trim());
            return { name, phone };
        }).filter(c => c.name && c.phone);

        if (contacts.length === 0) {
            addLog('❌ Error: No valid contacts found. Please fill in the contacts section.');
            return;
        }

        const agenda = [];
        agendaDayContents.forEach(dayContent => {
            const dayId = dayContent.dataset.day;
            const eventSlots = dayContent.querySelectorAll('.event-slot');
            eventSlots.forEach(slot => {
                const date = slot.querySelector('.event-date').value;
                const time = slot.querySelector('.event-time').value;
                const message = slot.querySelector('.event-message').value.trim();

                if (date && time && message) {
                    agenda.push({
                        day: dayId,
                        date: date,
                        time: time,
                        message: message
                    });
                }
            });
        });

        if (agenda.length === 0) {
            addLog('❌ Error: No agenda events defined. Please add at least one event with date, time, and message.');
            return;
        }

        setStartButtonState(false); 
        setAgendaScheduleButtonState(false); 
        scheduledEventsSummary.classList.add('hidden'); // Hide summary until confirmed
        eventsList.innerHTML = ''; // Clear summary list

        addLog('Sending agenda to server for scheduling...');
        socket.emit('schedule-agenda', { contacts, agenda });
    });
});