/* AAP Attendance — server connection.
 * API_URL: the EMPLOYEE web app URL from Apps Script (Deploy → Manage deployments → the "Anyone" deployment → Web app URL, ends with /exec).
 * APK_URL: the Android app file (uploaded after it is built with PWABuilder).
 * ANDROID_PACKAGE: the app's package ID (used by the "Open the app" button). */
window.APP_CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbwYQ9StXjqnQcxOHiYLWIy0FZqIP_CWSP3y-JXAf4XKO9MNJCl15MgdGan0XNNmggye/exec',
  APK_URL: 'download/AAP-Attendance.apk',
  ANDROID_PACKAGE: 'io.github.vimal_coder_mis.twa'
};
