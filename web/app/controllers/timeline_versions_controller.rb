class TimelineVersionsController < ApplicationController
  before_action :set_fellow
  before_action :require_fellow_editor, only: :create

  def index
    @versions = @fellow.timeline_versions.includes(:author).reverse
  end

  # Saves the timeline as it stands now. After delivery this is how the story keeps
  # growing without ever touching the sealed capsule.
  def create
    stage = @fellow.stage == "delivered" && @fellow.timeline_versions.none? { |v| v.stage == "after_interview" } ? "after_interview" : "revision"
    version = TimelineVersion.capture!(@fellow, stage:, author: current_user, label: params[:label])
    audit("timeline.version_saved", subject: version, stage:, snapshot_sha256: version.snapshot_sha256)
    redirect_to fellow_timeline_versions_path(@fellow), notice: "Saved “#{version.label}”."
  end
end
