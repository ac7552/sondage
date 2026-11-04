class DownloadsController < ApplicationController
  def show
    @downloads = Rails.configuration.x.desktop_downloads
    ua = request.user_agent.to_s
    @platform = ua.include?("Mac") ? :mac : ua.include?("Windows") ? :windows : :linux
  end
end
