# Call servers (STUN, and the TURN relay for homes that can't connect directly)
# are made per person in app/models/call_relay.rb, with short-lived relay passwords.

# How long after a recovery request Sondage may release its own safety copy.
# The Fellow and family are emailed straight away, so this is their window to object.
Rails.application.config.x.recovery_wait_hours = ENV.fetch("RECOVERY_WAIT_HOURS", Rails.env.production? ? 72 : 0).to_f

# Where the desktop app is downloaded from. By default, the newest GitHub release:
# .github/workflows/release.yml builds the installers and attaches them under these
# names, and GitHub's /releases/latest/download/ always points at the newest one.
# Override all three with DESKTOP_DOWNLOAD_BASE (e.g. your own storage), or one at a
# time with DESKTOP_MAC_URL and the like.
desktop_base = ENV.fetch("DESKTOP_DOWNLOAD_BASE", "https://github.com/ac7552/sondage/releases/latest/download").chomp("/")
Rails.application.config.x.desktop_downloads = {
  mac: ENV.fetch("DESKTOP_MAC_URL", "#{desktop_base}/Sondage-mac.dmg"),
  windows: ENV.fetch("DESKTOP_WINDOWS_URL", "#{desktop_base}/Sondage-windows.exe"),
  linux: ENV.fetch("DESKTOP_LINUX_URL", "#{desktop_base}/Sondage-linux.AppImage")
}
# How long a Sitting's countdown runs, in minutes. Stephen's first version: an hour.
Rails.application.config.x.sitting_minutes = ENV.fetch("SITTING_MINUTES", 60).to_i

# The Dropbox app the desktop app connects with (a public "app key", not a secret).
# Each Senior Fellow connects their own Dropbox; Sondage holds no token.
Rails.application.config.x.dropbox_app_key = ENV["DROPBOX_APP_KEY"].presence

# Shown on the download page when set, e.g. "0.1.0".
Rails.application.config.x.desktop_version = ENV["DESKTOP_VERSION"].presence
