class DashboardController < ApplicationController
  def show
    case current_user.role
    when "admin"
      @fellows = Fellow.includes(:user, :meetings).order(:created_at)
      @upcoming = Meeting.includes(:fellow, :host).where(status: %w[scheduled in_progress]).order(:scheduled_at)
      render :admin
    when "heir"
      @claims = current_user.inheritance_claims.includes(fellow: :user)
      render :heir
    when "historian"
      @interviews = current_user.hosted_meetings.interviews.includes(fellow: :user).order(:scheduled_at)
      render :historian
    else
      @fellow = current_user.fellow
      return render(plain: "No profile has been set up for this account yet.", status: :not_found) unless @fellow
      @interviews = @fellow.interviews.includes(:host, :capsule)
      @capsules = @fellow.capsules.includes(:meeting).order(:sealed_at)
      render :fellow
    end
  end
end
