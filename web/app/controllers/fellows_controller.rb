class FellowsController < ApplicationController
  before_action :set_fellow

  def show
    @answers = @fellow.intake_answers.includes(:intake_question).index_by(&:intake_question_id)
    @questions = IntakeQuestion.all
    @meetings = @fellow.meetings.includes(:host, :capsule)
    @versions = @fellow.timeline_versions.includes(:author)
    @audit = @fellow.audit_events.includes(:actor).order(created_at: :desc).limit(25)
  end

  # Admins can also set the historian directly (for example after a phone call).
  def assign_historian
    return head(:forbidden) unless current_user.admin?
    historian = params[:historian_id].present? ? User.where(role: "historian").find(params[:historian_id]) : nil
    @fellow.update!(historian:, seeking_historian: historian ? false : @fellow.seeking_historian)
    audit("fellow.historian_set", subject: @fellow, historian: historian&.name)
    redirect_to fellow_path(@fellow), notice: historian ? "#{historian.name} is now #{@fellow.display_name.split.first}'s historian." : "Historian removed."
  end

  def stage
    return head(:forbidden) unless current_user.admin?
    @fellow.update!(stage: params.require(:stage))
    audit("fellow.stage_changed", subject: @fellow, stage: @fellow.stage)
    redirect_to fellow_path(@fellow), notice: "Stage set to #{@fellow.stage_label}."
  end
end
