class Api::V1::TimelinesController < Api::V1::BaseController
  before_action :require_fellow!

  def show
    render json: TimelineSnapshot.new(@fellow).to_h
  end
end
