class TimelinesController < ApplicationController
  before_action :set_fellow
  layout "timeline"

  def show
    @versions = @fellow.timeline_versions.includes(:author)
    @version = @versions.find { |v| v.id.to_s == params[:version] }
    @data = @version ? @version.snapshot : TimelineSnapshot.new(@fellow).to_h
  end
end
