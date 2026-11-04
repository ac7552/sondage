# Admins release Sondage's own safety copy, after the waiting period, once they
# have confirmed it is really the Fellow asking (for example by phone).
class RecoveriesController < ApplicationController
  before_action :require_admin
  before_action :set_recovery

  def release
    return redirect_to(fellow_path(@fellow), alert: "Sondage's copy can't be released yet.") unless @recovery.sondage_releasable?
    @recovery.update!(sondage_released_at: Time.current, released_by: current_user)
    audit("recovery.sondage_released", subject: @recovery, note: params[:note].to_s.first(300))
    redirect_to fellow_path(@fellow), notice: "Sondage's safety copy is released to #{@fellow.display_name}'s new computer."
  end

  def cancel
    @recovery.update!(status: "cancelled")
    audit("recovery.cancelled", subject: @recovery)
    redirect_to fellow_path(@fellow), notice: "Recovery request cancelled."
  end

  private

  def set_recovery
    @recovery = Recovery.find(params[:id])
    @fellow = @recovery.fellow
  end
end
