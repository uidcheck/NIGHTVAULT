# PARACAUSAL

PARACAUSAL is a personal creative archive for music, videos, gallery work, and projects, built with Node.js, Express, EJS, SQLite, and a dark retro visual style.

## Features

- Public pages for Home, Music, Videos, Gallery, and Projects
- Admin login with session-based authentication
- Upload and manage:
  - music tracks and cover art
  - videos and thumbnails
  - gallery images
  - projects, project hero images, documents, and updates
- WAV music uploads are automatically converted to MP3 for faster web playback
- Playlists for music and videos
- Collections for gallery items and projects
- Global and section-based search/filtering
- SQLite database with seed/setup support
- Persistent music player with waveform visualisation
- Project updates with file attachments
- Automatic cleanup of uploaded files when content is deleted
- Orphaned upload cleanup utility
- Responsive dark archive-style interface

## Tech Stack

- Node.js
- Express
- EJS
- SQLite (for both app data and session storage)
- multer
- bcrypt
- express-session with persistent SQLite session store
- WaveSurfer.js

## Standard Setup

1. Clone or download the repository.
2. Change into the project folder.
3. Copy `.env.example` to `.env`.
4. Set a strong random value for `SESSION_SECRET` in `.env`.

Install dependencies:

```bash
npm install
```

Start the application:

```bash
npm start
```

The app will automatically:
- Create the SQLite database file if it doesn't exist
- Initialize all required tables and indexes
- Create a default admin account on first startup

Open the site in your browser at:

```text
http://localhost:3000
```

Log in with the default credentials:
- Username: `admin`
- Password: `password`

**Important:** Change the default admin password immediately after first login. See [Changing the Admin Password](#changing-the-admin-password) below.

## Docker Setup

This project can also be run with Docker Compose.

### Clone the repository

```bash
git clone https://github.com/uidcheck/paracausal.git
cd paracausal
```

### Copy the environment file

Linux/macOS:

```bash
cp .env.example .env
```

Windows CMD:

```bat
copy .env.example .env
```

Then edit `.env` and set a strong `SESSION_SECRET`.

For Docker, database storage is configured via `DB_PATH=/app/data/paracausal.db` in `docker-compose.yml`.

### Create persistent data folders

These folders are mounted into the container so database content and uploads are not lost when rebuilding.

Linux/macOS:

```bash
mkdir -p data uploads/music uploads/videos uploads/images uploads/projects uploads/documents
```

Windows CMD:

```bat
mkdir data
mkdir uploads
mkdir uploads\music
mkdir uploads\videos
mkdir uploads\images
mkdir uploads\projects
mkdir uploads\documents
```

### Build and start the container

```bash
docker compose up -d --build
```

### Open the site

```text
http://localhost:3000
```

### View logs

```bash
docker compose logs -f
```

### Stop the container

```bash
docker compose down
```

## Environment Variables

Create a local `.env` file based on `.env.example`.

Example:

```env
PORT=3000
SESSION_SECRET=replace-this-with-a-long-random-secret
TRUST_PROXY=1
# Optional: override SQLite file path (default: database/paracausal.db)
# DB_PATH=database/paracausal.db
```

## Default Admin Account

On first startup, the app automatically creates a default admin account:

- Username: `admin`
- Password: `password`

This account is created only if no other admin account exists. If you delete the database file and restart, a new default admin will be created.

**IMPORTANT:** The default password is public and known. You must change it before any production use. See [Changing the Admin Password](#changing-the-admin-password) below.

## Changing the Admin Password

After logging in as admin:

1. Open the admin dashboard
2. Go to the **Account** section
3. Click **Change Password**
4. Enter:
   - your current password
   - your new password
   - confirmation of the new password

Password rules:

- minimum length: 8 characters
- current password must be correct
- new password and confirmation must match

After a successful password change, the new password takes effect immediately.

## Recovering Admin Access

If you forget the admin password, you can reset it directly inside the Docker container without losing any site content.

This only updates the admin password in the database. It does **not** delete music, videos, gallery items, projects, uploads, playlists, collections, or any other data.

### Open a shell inside the running container

```bash
docker compose exec paracausal sh
```

### Run the password reset command

Replace `NewPassword123` with the password you want to set.

```sh
node -e "const bcrypt=require('bcrypt'); const sqlite3=require('sqlite3').verbose(); bcrypt.hash('NewPassword123',10).then(hash=>{ const db=new sqlite3.Database('/app/data/paracausal.db'); db.run(\"UPDATE admins SET password = ? WHERE username = 'admin'\", [hash], function(err){ if(err){ console.error(err); process.exit(1);} console.log('Admin password reset successfully'); db.close(); }); });"
```

### Log in again

Use:

- Username: `admin`
- Password: the new password you just set

### Notes

- This does not reset or remove any site content
- It only updates the `admins.password` field in the SQLite database
- If your password contains special shell characters, use a simpler temporary password first, then change it from the admin panel after logging in

## Admin Usage

- Go to `/login`
- Sign in with the admin account
- Use the dashboard to manage music, videos, gallery items, projects, playlists, and collections

## Upload Storage

Uploaded files are stored under `uploads/`:

- `uploads/music/` — music playback files and cover images. WAV/WAVE uploads are converted to MP3 automatically and the converted MP3 is stored for playback.
- `uploads/videos/` — video files and thumbnails
- `uploads/images/` — gallery images
- `uploads/projects/` — project hero images
- `uploads/documents/` — project documents and update attachments

Make sure these folders are writable in your deployment environment.

## Database

The app uses SQLite for both application data and session storage.

**Database file (default local):** `database/paracausal.db`

You can override the database file path with `DB_PATH`.
Example Docker path: `/app/data/paracausal.db`

**Session storage:** Sessions are stored in the `sessions` table within the same SQLite database. This ensures:
- Sessions persist across app restarts
- Expired sessions are automatically cleaned up every 15 minutes
- Production-safe session handling (no more MemoryStore warnings)
- Sessions work correctly in Docker and containerized deployments

## Session And CSRF Hardening

- `SESSION_SECRET` is required when `NODE_ENV=production`
- In local development, if `SESSION_SECRET` is not set, the app uses a temporary fallback secret and logs a warning
- Session cookies are `httpOnly`, `sameSite=lax`, and use automatic `secure` handling in production
- `TRUST_PROXY=1` is recommended when running behind HTTPS via a reverse proxy so secure cookies are detected correctly
- State-changing auth and admin forms are protected by CSRF tokens

If you deploy behind a reverse proxy such as Nginx, Caddy, or a platform load balancer, set:

```env
NODE_ENV=production
SESSION_SECRET=replace-this-with-a-long-random-secret
TRUST_PROXY=1
```

Database files should not be committed to Git. Keep live database files outside version control.

## Docker Data Notes

When running with Docker Compose:

- SQLite database data is stored in `./data`
- Docker sets `DB_PATH=/app/data/paracausal.db` and mounts `./data:/app/data`
- Uploaded files are stored in `./uploads`
- Rebuilding the container does not remove your content as long as those folders are preserved
- The default admin account is automatically created on first startup

On your first access:

1. Open http://localhost:3000
2. Go to `/login`
3. Log in with:
   - Username: `admin`
   - Password: `password`
4. Change the password immediately in the admin panel (Account → Change Password)

## Maintenance

To scan for orphaned uploaded files without deleting anything:

```bash
node cleanup-orphaned-files.js --dry-run
```

To remove orphaned uploaded files:

```bash
node cleanup-orphaned-files.js
```

Use the dry run first.

## Usage

This is a personal project repository published for deployment and reference purposes. It is not intended as a general reusable package or public template.

## Notes

- Use a strong session secret in production
- Use HTTPS and a reverse proxy in production
- This project is intentionally designed with a dark, minimal, retro archive feel