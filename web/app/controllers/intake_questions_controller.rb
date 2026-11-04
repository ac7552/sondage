class IntakeQuestionsController < ApplicationController
  before_action :require_admin
  before_action :set_question, only: %i[edit update destroy]

  def index
    @sections = IntakeQuestion.all.group_by(&:section)
  end

  def new
    @question = IntakeQuestion.new(position: (IntakeQuestion.maximum(:position) || 0) + 10, section: IntakeQuestion.last&.section)
  end

  def create
    @question = IntakeQuestion.new(question_params)
    if @question.save
      redirect_to intake_questions_path, notice: "Question added."
    else
      render :new, status: :unprocessable_entity
    end
  end

  def edit; end

  def update
    if @question.update(question_params)
      redirect_to intake_questions_path, notice: "Question updated."
    else
      render :edit, status: :unprocessable_entity
    end
  end

  def destroy
    @question.destroy
    redirect_to intake_questions_path, notice: "Question removed."
  end

  private

  def set_question = @question = IntakeQuestion.find(params[:id])
  def question_params = params.require(:intake_question).permit(:section, :prompt, :help, :kind, :options, :required, :position)
end
