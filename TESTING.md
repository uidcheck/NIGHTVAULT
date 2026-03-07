# PARACAUSAL Testing Guide

This document provides manual test cases for the PARACAUSAL website, covering automatic initialization, login, uploads, public rendering, project CRUD, playlists/collections, file cleanup, and access protection.

## Prerequisites

1. Ensure Node.js and npm are installed.
2. Change into the project directory:

       cd /d "C:\path\to\paracausal"

3. Install dependencies:

       npm install

4. Copy `.env.example` to `.env`.
5. Set `SESSION_SECRET` in `.env` to a long random secret.
6. Start the server:

       npm start

   The app will automatically create the database, tables, and default admin account on first startup.

7. Open a browser and go to:

       http://localhost:3000

## Default Admin Credentials

These are automatically created on first startup.

- Username: `admin`
- Password: `password`

Change them immediately after first login before any real deployment.

---

## 0. Fresh Startup Auto-Initialization

### 0.1 First-Time Startup Creates Database and Admin
**Objective:** Verify that a fresh startup creates tables, indexes, and the default admin without manual intervention.

**Steps:**
1. Delete the database file (if one exists from previous testing):
   - Windows: Delete `database\paracausal.db`
   - Linux/macOS: Delete `database/paracausal.db`
2. From the project directory, run:

       npm start

3. Wait for the server to start (should see log messages about initialization)
4. Once the server is running, open http://localhost:3000
5. Try to go to `/login`

**Expected Result:**
- Server starts successfully
- Console shows log messages indicating:
  - Database tables were created
  - Default admin was created with message: "✓ Default admin account created"
- Login page renders
- You can log in with default credentials (admin/password)

---

### 0.2 Restart Does Not Duplicate Admin
**Objective:** Verify that restarting the app does not create duplicate admin accounts.

**Steps:**
1. After the server started above, copy down the console log output
2. Stop the server (Ctrl+C)
3. Restart it:

       npm start

4. Check the console output

**Expected Result:**
- Server starts successfully
- Console shows log message: "✓ Admin account check passed (1 admin(s) exist)"
- No "Default admin account created" message appears
- No duplicate admins were inserted

---

### 0.3 Session Persistence Across Restarts
**Objective:** Verify that user sessions persist across server restarts (production-safe session store).

**Steps:**
1. After the server is running, log in as admin (admin/password)
2. Verify you're logged in (dashboard shows)
3. Open browser developer tools → Application → Cookies
4. Find and note the `connect.sid` cookie value (session ID)
5. Stop the server (Ctrl+C)
6. Wait 2 seconds
7. Restart the server:

       npm start

8. Refresh the browser (or navigate to `/admin`)
9. Check if you're still logged in

**Expected Result:**
- After restart, you remain logged in
- The `connect.sid` cookie is still valid
- You can access `/admin` without being redirected to login
- Session was recovered from the database
- Console shows cleanup messages for expired sessions (if any)

**Verification**: This confirms sessions are persisted to SQLite and not lost on restart.

---

## 1. Login Functionality

### 1.1 Successful Admin Login
**Objective:** Verify that admin login works with valid credentials.

**Steps:**
1. Go to `/login`
2. Enter the default admin credentials
3. Click **Login**

**Expected Result:**
- Redirect to `/admin`
- Admin dashboard loads
- Navigation shows **Dashboard** and **Logout**

---

### 1.2 Failed Login with Invalid Credentials
**Objective:** Ensure invalid credentials are rejected.

**Steps:**
1. Go to `/login`
2. Enter an incorrect username/password
3. Click **Login**

**Expected Result:**
- Stay on login page
- Error message: `Invalid credentials`

---

### 1.3 Access Login Page While Already Logged In
**Objective:** Confirm logged-in admins are redirected away from the login page.

**Steps:**
1. Log in as admin
2. Visit `/login`

**Expected Result:**
- Redirect to `/admin`

---

## 2. Admin Password Change

### 2.1 Access Change Password Page
**Objective:** Verify admins can access the password change page.

**Steps:**
1. Log in as admin
2. Go to `/admin` (dashboard)
3. Click **Change Password** under the Account section

**Expected Result:**
- Navigates to `/admin/change-password`
- Form displays with fields: Current Password, New Password, Confirm New Password
- Back link to dashboard is visible

---

### 2.2 Password Change – Wrong Current Password
**Objective:** Verify that entering an incorrect current password fails.

**Steps:**
1. Navigate to `/admin/change-password`
2. Enter an incorrect current password
3. Enter a valid new password (minimum 8 characters)
4. Confirm the new password
5. Submit

**Expected Result:**
- Error message: `Current password is incorrect.`
- Password is NOT changed
- User remains on the change password page

---

### 2.3 Password Change – Mismatched New Passwords
**Objective:** Verify that mismatched new and confirm passwords fail.

**Steps:**
1. Navigate to `/admin/change-password`
2. Enter correct current password
3. Enter a new password
4. Enter a different password in the confirm field
5. Submit

**Expected Result:**
- Error message: `New password and confirmation do not match.`
- Password is NOT changed
- User remains on the change password page

---

### 2.4 Password Change – Too Short Password
**Objective:** Verify that passwords shorter than 8 characters are rejected.

**Steps:**
1. Navigate to `/admin/change-password`
2. Enter correct current password
3. Enter a new password less than 8 characters (e.g., `abc123`)
4. Confirm it
5. Submit

**Expected Result:**
- Error message: `New password must be at least 8 characters long.`
- Password is NOT changed
- User remains on the change password page

---

### 2.5 Password Change – Successful Change
**Objective:** Verify that a valid password change works correctly.

**Steps:**
1. Navigate to `/admin/change-password`
2. Enter correct current password (`password` if using defaults)
3. Enter a valid new password (minimum 8 characters, e.g., `newpassword123`)
4. Confirm it
5. Submit

**Expected Result:**
- Success message: `Password changed successfully.`
- Redirect to `/admin` (dashboard)
- User remains logged in

---

### 2.6 Verify Old Password No Longer Works
**Objective:** Verify that the old password is no longer valid after change.

**Steps:**
1. Perform test 2.5 to change the password
2. Log out
3. Attempt to log in with the old password

**Expected Result:**
- Login fails
- Error message: `Invalid credentials`

---

### 2.7 Verify New Password Works
**Objective:** Verify that the new password works for login.

**Steps:**
1. Perform test 2.5 to change the password
2. Log out
3. Log in with the new password

**Expected Result:**
- Login succeeds
- Redirect to `/admin`
- Dashboard loads normally

---

## 3. Uploads

### 3.1 Upload Music Track
**Objective:** Verify music upload with metadata.

**Steps:**
1. Log in as admin
2. Go to `/admin/music/new`
3. Fill in metadata
4. Upload an audio file
5. Optionally upload a cover image
6. Submit the form

**Expected Result:**
- Redirect to `/admin/music`
- Success message shown
- Track appears in the list
- Files exist in `uploads/music/`

---

### 2.2 Upload Gallery Image
**Objective:** Verify gallery image upload.

**Steps:**
1. Log in as admin
2. Go to `/admin/gallery/new`
3. Fill in title/caption/category
4. Upload an image
5. Submit

**Expected Result:**
- Redirect to `/admin/gallery`
- Success message shown
- Image appears in the list
- File exists in `uploads/images/`

---

### 2.3 Upload Video
**Objective:** Verify video upload.

**Steps:**
1. Log in as admin
2. Go to `/admin/videos/new`
3. Fill in metadata
4. Upload a video file
5. Optionally upload a thumbnail
6. Submit

**Expected Result:**
- Redirect to `/admin/videos`
- Success message shown
- Video appears in the list
- File exists in `uploads/videos/`

---

### 2.4 Upload Project Hero Image
**Objective:** Verify project creation with hero image.

**Steps:**
1. Log in as admin
2. Go to `/admin/projects/new`
3. Fill in project details
4. Upload a hero image
5. Submit

**Expected Result:**
- Redirect to `/admin/projects`
- Success message shown
- Project appears in the list
- Hero image exists in `uploads/projects/`

---

## 4. Public Rendering

### 4.1 Home Page
**Objective:** Verify the home page renders correctly.

**Expected Result:**
- Site title `PARACAUSAL`
- Subtitle `Built on Feeling, Not Formula`
- Navigation visible
- Main archive cards visible
- Footer visible

---

### 3.2 Music Archive
**Objective:** Verify the music page works.

**Steps:**
1. Visit `/music`
2. Play a track if one exists

**Expected Result:**
- Tracks render correctly
- Player works
- Search/filter controls render
- Playlist sidebar renders even if empty

---

### 3.3 Videos Archive
**Objective:** Verify the videos page works.

**Steps:**
1. Visit `/videos`

**Expected Result:**
- Videos render correctly
- Search/filter controls render
- Playlist sidebar renders even if empty

---

### 3.4 Gallery
**Objective:** Verify gallery rendering and lightbox.

**Steps:**
1. Visit `/gallery`
2. Click an image

**Expected Result:**
- Images render in the archive
- Lightbox opens correctly
- Collections sidebar renders even if empty

---

### 4.5 Projects Archive and Detail
**Objective:** Verify project list/detail pages.

**Steps:**
1. Visit `/projects`
2. Open a project detail page

**Expected Result:**
- Projects render as cards
- Hero image, title, summary, and status render cleanly
- Collections sidebar renders even if empty
- Project detail page shows updates and attachments

---

### 4.6 404 Page
**Objective:** Verify missing routes show a proper 404 page.

**Steps:**
1. Visit a fake URL such as `/this-does-not-exist`

**Expected Result:**
- A proper 404 page renders with the site layout

---

## 5. Music / Video / Collection Features

### 5.1 Music Playlist Browsing
**Objective:** Verify public music playlists work.

**Steps:**
1. Visit `/music`
2. Select a playlist

**Expected Result:**
- Sidebar displays playlists
- Tracks filter correctly
- Selected/playing track highlights correctly

---

### 5.2 Video Playlist Browsing
**Objective:** Verify public video playlists work.

**Steps:**
1. Visit `/videos`
2. Select a playlist

**Expected Result:**
- Sidebar displays playlists
- Videos filter correctly

---

### 5.3 Music Player Layout and Behaviour
**Objective:** Verify the persistent player works correctly.

**Steps:**
1. Start a track from `/music`
2. Use play/pause, prev/next, volume, and waveform
3. Navigate to another page

**Expected Result:**
- Track keeps playing
- Queue persists
- Waveform scrubs correctly
- Player layout remains compact and usable

---

### 5.4 Collection and Playlist Creation
**Objective:** Verify admin playlist/collection creation forms work.

**Steps:**
1. Go to:
   - `/admin/playlists/music`
   - `/admin/playlists/videos`
   - `/admin/collections/gallery`
   - `/admin/collections/projects`
2. Create a new item with a title

**Expected Result:**
- Form submits successfully
- New playlist/collection appears
- Empty title still correctly triggers validation

---

## 6. Project CRUD

### 6.1 Create Project
**Objective:** Verify project creation.

**Expected Result:**
- Project is created successfully
- Slug is generated
- Duplicate titles do not crash and generate unique slugs

---

### 5.2 Edit Project
**Objective:** Verify project editing works.

**Expected Result:**
- Project updates save correctly
- Replaced hero image updates correctly

---

### 5.3 Add Project Update
**Objective:** Verify adding a project update.

**Expected Result:**
- Update appears on admin edit page
- Update appears on public project detail page

---

### 5.4 Delete Project Update
**Objective:** Verify deleting a project update.

**Expected Result:**
- Update is removed
- Any attached files are removed from disk

---

### 5.5 Delete Project
**Objective:** Verify deleting a project.

**Expected Result:**
- Project is removed
- Related files are removed from disk

---

## 7. File Cleanup and Replacement

### 7.1 Delete Music Track
**Expected Result:**
- DB record removed
- Audio file removed from disk
- Cover image removed from disk if present

---

### 6.2 Delete Video
**Expected Result:**
- DB record removed
- Video file removed from disk
- Thumbnail removed from disk if applicable

---

### 6.3 Delete Gallery Image
**Expected Result:**
- DB record removed
- Image removed from disk

---

### 6.4 Replace Uploaded Files
**Expected Result:**
- Old file removed from disk
- New file saved and displayed correctly

---

### 6.5 Orphan Cleanup Utility
**Steps:**
1. Run:

       node cleanup-orphaned-files.js --dry-run

2. Confirm it reports orphaned files safely without deleting
3. Run live cleanup only when satisfied

**Expected Result:**
- Dry run shows what would be removed
- Live run removes only orphaned files

---

## 8. Access Protection

### 8.1 Protect Admin Routes
**Objective:** Ensure admin pages require login.

**Steps:**
1. Log out
2. Visit `/admin`

**Expected Result:**
- Redirect to `/login`
- Error message shown

---

### 8.2 Public Pages Stay Public
**Objective:** Ensure public pages do not require login.

**Steps:**
1. Log out
2. Visit `/`, `/music`, `/videos`, `/gallery`, `/projects`

**Expected Result:**
- Pages load normally

---

### 8.3 Session Persistence
**Objective:** Ensure sessions remain active across requests.

**Steps:**
1. Log in
2. Refresh `/admin`
3. Open more admin pages
4. Log out

**Expected Result:**
- Session stays active until logout
- Logout clears access

---

## Additional Notes

- Flash messages should appear for successful and failed actions
- Uploaded files should be accessible under `/uploads/...`
- Live database and uploads should not be committed to Git
- Test in more than one browser where possible
- Test mobile-width layouts where possible
- Use a strong session secret and HTTPS in production