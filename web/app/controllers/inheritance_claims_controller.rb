# Admins check a reported death before anything can be opened.
class InheritanceClaimsController < ApplicationController
  before_action :require_admin
  before_action :set_claim

  def confirm
    return redirect_to(fellow_path(@fellow), alert: "This has already been decided.") unless @claim.reported?
    note = params[:note].to_s.strip
    return redirect_to(fellow_path(@fellow), alert: "Please write how you checked.") if note.blank?
    user = @claim.confirm!(current_user, note:)
    audit("inheritance.confirmed", subject: @claim, heir: @claim.safety_contact.name, note:)
    SafetyMailer.heir_ready(@claim).deliver_later
    user.send_reset_password_instructions if user.previously_new_record? # a new account: let them set a password
    redirect_to fellow_path(@fellow), notice: "Confirmed. #{@claim.safety_contact.name} has been emailed how to open the recordings."
  rescue ArgumentError => e
    redirect_to fellow_path(@fellow), alert: e.message
  end

  def refuse
    return redirect_to(fellow_path(@fellow), alert: "This has already been decided.") unless @claim.reported?
    @claim.refuse!(current_user, note: params[:note])
    audit("inheritance.refused", subject: @claim)
    redirect_to fellow_path(@fellow), notice: "Marked as not true. Nothing was opened."
  end

  private

  def set_claim
    @claim = InheritanceClaim.find(params[:id])
    @fellow = @claim.fellow
  end
end
