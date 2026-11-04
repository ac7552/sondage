class IntakesController < ApplicationController
  before_action :set_fellow
  before_action :require_fellow_editor, except: :show

  def show
    @sections = IntakeQuestion.all.group_by(&:section)
    @answers = @fellow.intake_answers.index_by(&:intake_question_id)
    @events = @fellow.events.where(stage_added: "intake")
    @event = @fellow.events.build(stage_added: "intake")
  end

  def update
    answers = params.fetch(:answers, {}).to_unsafe_h
    ActiveRecord::Base.transaction do
      IntakeQuestion.all.each do |q|
        next unless answers.key?(q.id.to_s)
        raw = answers[q.id.to_s]
        value = q.kind == "multi_select" ? Array(raw).compact_blank.to_json : raw.to_s.strip
        answer = @fellow.intake_answers.find_or_initialize_by(intake_question: q)
        answer.update!(value:, answered_by: current_user)
      end
      apply_profile_answers(answers)
    end
    audit("intake.saved")
    redirect_to fellow_intake_path(@fellow), notice: "Saved. You can come back and change anything until the intake is complete."
  end

  def complete
    version = TimelineVersion.capture!(@fellow, stage: "after_intake", author: current_user)
    @fellow.update!(stage: "ten_by_ten") if @fellow.stage == "intake"
    audit("intake.completed", subject: version, snapshot_sha256: version.snapshot_sha256)
    redirect_to fellow_timeline_path(@fellow), notice: "Intake complete. The first version of the timeline has been saved."
  end

  private

  # A few intake answers also fill in the profile itself.
  def apply_profile_answers(answers)
    by_prompt = IntakeQuestion.all.index_by { |q| q.prompt.downcase }
    year = answers[by_prompt["what year were you born?"]&.id.to_s]
    place = answers[by_prompt["where were you born?"]&.id.to_s]
    @fellow.update!(birth_year: year.presence&.to_i || @fellow.birth_year, birth_place: place.presence || @fellow.birth_place)
  end
end
