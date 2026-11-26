NEXUS — Private Messenger

A username-based private messaging application designed around simple communication, contact approval, persistent conversations and real-time message delivery.

NEXUS is being developed with a mobile-first approach, initially using Android Termux, with the goal of making it available to users through a hosted web application.

> **Project status:** Active development. Some features are implemented, while others remain planned. This README distinguishes between them.

---

1. Features

Currently implemented

- Username-based user accounts.
- Invitation-based registration.
- Password hashing using Argon2id.
- Secure session cookies.
- Login, logout and session verification.
- Contact requests using usernames.
- Accepting, rejecting and cancelling contact requests.
- Removing existing contacts.
- Direct conversations between accepted contacts.
- Persistent message storage using PostgreSQL.
- Real-time messaging using WebSockets.
- Message delivery and read-receipt handling.
- Unread message counts.
- Mobile-friendly web interface.
- Super Admin role and protected admin routes.
- Authentication rate limiting.
- HTTP security headers.

Planned features

These are future development goals, not promises of current functionality.

- End-to-end encryption (E2EE).
- Image, video and file sharing.
- Voice messages.
- Voice and video calls.
- Group conversations.
- Android application package (APK).
- Push notifications.
- Multi-device session management improvements.
- Additional privacy and security improvements.

---

2. Important security information

NEXUS currently uses password hashing, authenticated sessions and protected API routes.

It does not currently provide verified end-to-end encryption.

This means:

- Passwords are stored as password hashes, not plain text.
- Session tokens are stored in hashed form in the database.
- Messages are stored in PostgreSQL.
- The server processes message content and can technically access plaintext messages.
- The Super Admin interface does not provide a message-reading feature, but this is not the same as cryptographically preventing server access.

Do not use NEXUS for highly sensitive communications until proper end-to-end encryption has been implemented and independently reviewed.

Also remember that hosting providers and network infrastructure may process connection metadata, including IP addresses.

---

3. Technology stack

Component| Technology
Backend| Node.js
Backend framework| Express 5
Language| TypeScript
Database| PostgreSQL
Database hosting| Neon
Database driver| node-postgres ("pg")
Authentication hashing| Argon2id
Session token hashing| SHA-256
Real-time communication| WebSockets ("ws")
Frontend| HTML, CSS and JavaScript
Security headers| Helmet
Request limiting| express-rate-limit
Development runner| tsx
Version control| Git and GitHub

---

4. Project structure

The repository contains the backend and its public frontend files.

NEXUS/
│
├── README.md
│
└── server/
    │
    ├── package.json
    ├── package-lock.json
    ├── tsconfig.json
    ├── .env
    ├── .gitignore
    │
    ├── public/
    │   ├── index.html
    │   ├── script.js
    │   ├── style.css
    │   └── nexus-style.css
    │
    ├── src/
    │   ├── server.ts
    │   ├── database.ts
    │   ├── migrate.ts
    │   ├── schema.sql
    │   ├── realtime.ts
    │   │
    │   ├── middleware/
    │   │   └── requireUser.ts
    │   │
    │   ├── routes/
    │   │   ├── auth.ts
    │   │   ├── admin.ts
    │   │   ├── contacts.ts
    │   │   └── conversations.ts
    │   │
    │   └── scripts/
    │       └── check-admin-password.ts
    │
    └── dist/
        └── Compiled JavaScript files

The "dist/" directory is generated when the project is built. It is not the main source-code directory.

The ".env" file contains private configuration and must never be uploaded to GitHub.

---

5. Requirements

To run NEXUS locally, you need:

- Node.js (a supported modern version).
- npm.
- Git.
- Internet connection.
- A PostgreSQL database.
- A Neon account for the current hosted database setup.

For Android development:

- Android phone.
- Termux.
- Internet connection.

For production hosting:

- A server platform that supports Node.js.
- HTTPS.
- WebSocket connections.
- Access to a PostgreSQL database.

---

6. Installing NEXUS on Android using Termux

Step 1: Install Termux

Install Termux from a trusted source.

Open Termux and update the packages:

pkg update && pkg upgrade

Install the required tools:

pkg install nodejs git

Check the installations:

node -v
npm -v
git --version

Step 2: Clone the repository

If the GitHub repository is private, the person cloning it must have repository access.

git clone https://github.com/Hari123e/NEXUS.git

Enter the project:

cd NEXUS/server

Step 3: Install dependencies

npm install

This installs the packages defined in "package.json".

Step 4: Configure environment variables

Create the environment file:

nano .env

Add the following configuration:

DATABASE_URL=YOUR_NEON_DATABASE_CONNECTION_STRING
NODE_ENV=development
PORT=3000

Replace the database placeholder with your actual Neon PostgreSQL connection string.

Save the file and exit the editor.

Protect the file:

chmod 600 .env

Never share your actual database URL, password or ".env" contents.

---

7. Setting up the Neon database

NEXUS currently uses Neon PostgreSQL.

Step 1: Create a Neon account

Visit:

https://neon.com/

Create an account and a PostgreSQL project.

Step 2: Create or select a database

Use the database and credentials provided by Neon.

Step 3: Get the connection string

Copy the PostgreSQL connection string from the Neon dashboard.

It generally follows this format:

postgresql://USERNAME:PASSWORD@HOST/DATABASE?sslmode=require

Use the actual connection string in your ".env" file.

Do not publish this connection string.

Step 4: Run database migrations

From the "server" directory:

npx tsx src/migrate.ts

The migration process:

1. Connects to PostgreSQL.
2. Reads "src/schema.sql".
3. Applies the schema inside a database transaction.
4. Ensures the "messages.delivered_at" column exists.
5. Commits the changes if successful.
6. Rolls back the transaction if the schema operation fails.

A successful migration prints:

NEXUS DATABASE MIGRATION SUCCESSFUL!

The migration script closes its database connection when finished.

Important: Do not delete or reset your existing database just to install a newer version of NEXUS. Back up important data before applying schema changes.

---

8. Running NEXUS

Make sure you are inside:

NEXUS/server

Start development mode

npm run dev

This uses "tsx watch" to run the TypeScript server and watch for source changes.

The server uses port "3000" by default unless another "PORT" is configured.

Open your browser:

http://localhost:3000

Check server health

Open:

http://localhost:3000/api/health

A healthy server responds with JSON similar to:

{
  "status": "healthy",
  "service": "NEXUS Backend"
}

Stop the server

In Termux, press:

CTRL + C

---

9. Production build

When you want to test the compiled production version:

Step 1: Build TypeScript

npm run build

Step 2: Configure production environment

Use the production database connection string and:

NODE_ENV=production
PORT=3000

Keep all credentials private.

Step 3: Start the compiled server

npm start

The production entry point is:

dist/server.js

The server listens on "0.0.0.0" and uses the configured "PORT", defaulting to "3000".

---

10. How NEXUS works

Account registration

NEXUS currently uses invitation-based registration.

The registration process requires:

- A username.
- A password.
- A valid invitation.

Username requirements:

- Minimum 3 characters.
- Maximum 30 characters.
- Letters, numbers and underscores are allowed.

Passwords must contain at least 12 characters.

Passwords are hashed using Argon2id.

Login and sessions

After successful login:

- NEXUS creates a random session token.
- The token is hashed before being stored in the database.
- The browser receives an HttpOnly session cookie named "nexus_session".
- Sessions expire after 7 days.

The cookie uses Secure in production and SameSite Strict.

Adding contacts

Users can find another person using their username.

The contact workflow is:

1. Send a contact request.
2. The other user receives the request.
3. The other user accepts or rejects it.
4. Once accepted, both users become contacts.
5. Accepted contacts can start direct conversations.

Sending messages

Once two users are accepted contacts:

1. One user opens a conversation.
2. The message is submitted to the backend.
3. The backend verifies conversation membership.
4. The message is saved in PostgreSQL.
5. Connected clients receive real-time updates through WebSockets.

Messages remain stored in the database, so reopening the application does not automatically erase the conversation.

---

11. API overview

The following are the main API routes currently implemented.

All API requests and responses use JSON unless otherwise indicated.

Health

Method| Endpoint| Purpose
GET| "/api/health"| Check backend health

Authentication

Base path: "/api/auth"

Method| Endpoint| Purpose
POST| "/register"| Register using an invitation
POST| "/login"| Log in
GET| "/me"| Check current session
POST| "/logout"| Log out

Contacts

Base path: "/api/contacts"

These endpoints require authentication.

Method| Endpoint| Purpose
GET| "/"| List accepted contacts
GET| "/requests"| View incoming and outgoing requests
POST| "/requests"| Send a contact request
POST| "/requests/:id/accept"| Accept a request
POST| "/requests/:id/reject"| Reject a request
POST| "/requests/:id/cancel"| Cancel an outgoing request
DELETE| "/:contactUserId"| Remove a contact

Example contact request:

{
  "username": "friend_username"
}

Conversations

Base path: "/api/conversations"

These endpoints require authentication.

Method| Endpoint| Purpose
POST| "/"| Create or retrieve a direct conversation
GET| "/"| List conversations
GET| "/:id/messages"| Retrieve messages
POST| "/:id/messages"| Send a message

Example conversation request:

{
  "username": "friend_username"
}

Example message request:

{
  "body": "Hello from NEXUS!"
}

Message length is limited to 1–4000 characters.

The message history endpoint returns the latest 50 messages in chronological order.

WebSocket communication

NEXUS uses an authenticated WebSocket endpoint:

/ws

The WebSocket connection uses the same session cookie as the HTTP API.

Some implemented event types include:

Event| Purpose
"join"| Join a conversation after membership verification
"new_message"| Notify clients of a new message
"delivered"| Report message delivery
"message_delivered"| Notify clients of delivery
"messages_read"| Notify clients of read receipts

Conversation membership is checked before a user can subscribe to a conversation.

---

12. Database overview

NEXUS uses PostgreSQL tables for account management, authentication and messaging.

The current schema includes:

- "users"
- "invitations"
- "devices"
- "sessions"
- "audit_logs"
- "contact_requests"
- "contacts"
- "conversations"
- "conversation_members"
- "messages"

The schema is maintained in:

src/schema.sql

The migration entry point is:

src/migrate.ts

Messages include a "delivered_at" timestamp for delivery tracking.

Do not manually remove database tables or columns without checking the application code and migration requirements.

---

13. Super Admin

NEXUS includes a protected admin router and a Super Admin role.

The admin middleware checks that the authenticated account is active and has the "super_admin" role.

The current admin interface does not provide a message-reading feature.

Checking the Super Admin password

The repository includes a password verification script:

src/scripts/check-admin-password.ts

It checks the supplied "NEXUS_PASSWORD" against the stored password hash of the Super Admin username "Hari123e".

To use it:

1. Set "NEXUS_PASSWORD" temporarily in your local environment.
2. Run:

npx tsx src/scripts/check-admin-password.ts

3. Check the result.
4. Remove the temporary password from the environment when finished.

This script verifies an existing account. It does not create an admin account or reset its password.

Do not publish the password or its value in GitHub documentation.

---

14. Deploying NEXUS online

Local Termux hosting is useful for development, but it is not suitable as a permanent public service.

For a public deployment, NEXUS needs a cloud server.

A suitable hosting platform must support:

- Node.js.
- Long-running backend processes.
- WebSocket connections.
- HTTPS.
- Environment variables.
- Outbound connections to Neon PostgreSQL.

Production deployment checklist

1. Push the latest code to GitHub.
2. Create a Node.js web service on your chosen hosting provider.
3. Connect the GitHub repository.
4. Set the service's root directory to "server".
5. Set the build command:

npm install && npm run build

6. Set the start command:

npm start

7. Configure environment variables in the hosting dashboard:

DATABASE_URL=YOUR_NEON_DATABASE_CONNECTION_STRING
NODE_ENV=production

8. Configure the database before starting the production service.
9. Apply database migrations using the configured production environment.
10. Confirm the service starts successfully.
11. Test the health endpoint.
12. Test login, contact requests, messaging and WebSocket communication.

The hosting provider should supply the port through its "PORT" environment variable.

Do not hardcode a public port if the hosting provider expects the application to use its assigned port.

Important: The exact deployment steps depend on the selected hosting provider. Do not assume that a successful local Termux run means production deployment is already complete.

---

15. GitHub backup and recovery

GitHub is the source-code backup for NEXUS.

The repository is:

https://github.com/Hari123e/NEXUS

Check the current Git status

From the project root:

cd ~/NEXUS
git status

Save changes

git add .
git commit -m "Describe your changes"
git push origin main

Download the project again

On a new device:

git clone https://github.com/Hari123e/NEXUS.git

Enter the backend directory:

cd NEXUS/server

Install dependencies:

npm install

Create a new ".env" file using your own database connection string.

Run the migration if the database needs to be initialized:

npx tsx src/migrate.ts

Start NEXUS:

npm run dev

Important recovery information

GitHub stores the source code, not your private environment variables or a complete backup of the live database.

For a full recovery, you need:

- Access to the GitHub repository.
- Access to the Neon database.
- The correct database connection string.
- Any required production environment variables.
- Database backups if you need to recover historical data.

Never commit ".env", database credentials, session tokens or other secrets.

---

16. Troubleshooting

Problem: "package.json" not found

You are probably in the wrong directory.

Use:

cd ~/NEXUS/server

Then:

cat package.json

Problem: "DATABASE_URL is missing"

Check that ".env" exists inside the "server" directory.

ls -la

Make sure the file contains:

DATABASE_URL=YOUR_NEON_DATABASE_CONNECTION_STRING

Do not post the connection string publicly.

Problem: Database connection fails

Check:

- Your internet connection.
- Whether the Neon database is available.
- Whether the connection string is correct.
- Whether the database credentials are valid.
- Whether the database allows connections from your hosting environment.

Local Termux development uses a DNS resolution workaround. Production uses normal DNS resolution.

Problem: Port already in use

Another process may already be using the configured port.

Stop the existing server with:

CTRL + C

Or configure a different available port.

Problem: NEXUS page does not open

Check that:

- The backend is running.
- You are using the correct URL.
- The server has started without errors.
- The configured port is correct.

Problem: Messages do not arrive in real time

Check:

- Whether the WebSocket connection is established.
- Whether the user is logged in.
- Whether the user belongs to the conversation.
- Whether the server is still running.
- Whether the hosting provider supports WebSockets.

Problem: TypeScript build fails

Run:

npm install

Then:

npm run build

Read the first actual TypeScript error and correct the relevant source file.

---

17. Development commands — quick reference

Run these commands from "NEXUS/server".

Task| Command
Install dependencies| "npm install"
Start development server| "npm run dev"
Build TypeScript| "npm run build"
Start production server| "npm start"
Run database migration| "npx tsx src/migrate.ts"
Verify Super Admin password| "npx tsx src/scripts/check-admin-password.ts"

---

18. Development roadmap

The long-term goal is to make NEXUS a reliable, privacy-focused messenger.

Phase 1 — Core messaging

- [x] Backend setup
- [x] PostgreSQL integration
- [x] Authentication
- [x] Contact requests
- [x] Direct conversations
- [x] Persistent messages
- [x] WebSocket messaging
- [x] Delivery and read receipts
- [x] Initial responsive interface

Phase 2 — Deployment and reliability

- [ ] Cloud deployment
- [ ] Production database backup strategy
- [ ] Better error handling
- [ ] WebSocket reconnection improvements
- [ ] Session management improvements
- [ ] Security review

Phase 3 — Privacy

- [ ] End-to-end encryption
- [ ] Secure key management
- [ ] Device verification
- [ ] Encrypted attachments

Phase 4 — Advanced messaging

- [ ] Image and file sharing
- [ ] Voice messages
- [ ] Group conversations
- [ ] Voice and video calls
- [ ] Push notifications

Phase 5 — Applications

- [ ] Progressive Web App improvements
- [ ] Android APK
- [ ] Desktop support
- [ ] iOS support

---

19. Contributing

Contributions, suggestions and bug reports are welcome.

Before contributing:

1. Read the existing source code.
2. Understand the authentication and database structure.
3. Avoid committing secrets.
4. Test changes locally.
5. Keep security and privacy in mind.
6. Document new features and API changes.

Do not introduce features that expose private messages or compromise user accounts.

---

20. Project vision

NEXUS aims to provide a simple and private communication experience where people can connect using usernames rather than needing to expose their phone numbers or personal details to other users.

The goal is to build a messenger that is:

- Simple to use.
- Mobile-friendly.
- Reliable.
- Privacy-conscious.
- Independent of unnecessary external account requirements for ordinary users.

NEXUS — Connect privately. Communicate freely.

---

Documentation reflects the project implementation inspected on 26 November 2026. As development continues, update this README whenever features, commands, configuration or deployment requirements change.
