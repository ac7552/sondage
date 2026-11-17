# The page where people get the desktop app, and stable links to each installer.
# Public: someone setting up a parent's computer may not have an account, and the app
# is no use without one anyway.
class DownloadsController < ApplicationController
  skip_before_action :authenticate_user!

  PLATFORMS = {
    mac: { name: "Mac", file: "Sondage-mac.dmg", needs: "macOS 12 Monterey or later" },
    windows: { name: "Windows", file: "Sondage-windows.exe", needs: "Windows 10 or later, 64-bit" },
    linux: { name: "Linux", file: "Sondage-linux.AppImage", needs: "64-bit Linux" }
  }.freeze

  def show
    ua = request.user_agent.to_s
    @phone = ua.match?(/iPhone|iPad|Android|Mobile/)
    @platform = ua.include?("Windows") ? :windows : ua.match?(/Linux|X11|CrOS/) && !ua.include?("Android") ? :linux : :mac
    @platforms = PLATFORMS
    @version = Rails.configuration.x.desktop_version
  end

  # /download/mac and so on: always the newest installer.
  def get
    redirect_to Rails.configuration.x.desktop_downloads.fetch(params[:platform].to_sym), allow_other_host: true, status: :found
  end
end
