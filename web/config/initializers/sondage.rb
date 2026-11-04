# Call servers (STUN, and the TURN relay for homes that can't connect directly)
# are made per person in app/models/call_relay.rb, with short-lived relay passwords.

# How long after a recovery request Sondage may release its own safety copy.
# The Fellow and family are emailed straight away, so this is their window to object.
Rails.application.config.x.recovery_wait_hours = ENV.fetch("RECOVERY_WAIT_HOURS", Rails.env.production? ? 72 : 0).to_f

# Where the Fellow downloads the desktop app.
Rails.application.config.x.desktop_downloads = {
  mac: ENV.fetch("DESKTOP_MAC_URL", "/downloads/Sondage-mac.dmg"),
  windows: ENV.fetch("DESKTOP_WINDOWS_URL", "/downloads/Sondage-windows.exe"),
  linux: ENV.fetch("DESKTOP_LINUX_URL", "/downloads/Sondage-linux.AppImage")
}
