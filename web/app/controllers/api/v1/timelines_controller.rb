class Api::V1::TimelinesController < Api::V1::BaseController
  requires_feature :timeline
  before_action :require_fellow!

  def show
    render json: TimelineSnapshot.new(@fellow).to_h
  end
end
