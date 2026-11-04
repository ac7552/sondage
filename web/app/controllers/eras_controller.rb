class ErasController < ApplicationController
  before_action :set_fellow
  before_action :require_fellow_editor
  before_action :set_era, only: %i[edit update destroy]

  def new = @era = @fellow.eras.build(start_year: (@fellow.eras.last&.end_year || @fellow.birth_year))

  def create
    @era = @fellow.eras.build(era_params)
    if @era.save
      audit("era.created", subject: @era)
      redirect_to fellow_timeline_path(@fellow), notice: "Added #{@era.title}."
    else
      render :new, status: :unprocessable_entity
    end
  end

  def edit; end

  def update
    if @era.update(era_params)
      audit("era.updated", subject: @era)
      redirect_to fellow_timeline_path(@fellow), notice: "Updated #{@era.title}."
    else
      render :edit, status: :unprocessable_entity
    end
  end

  def destroy
    @era.destroy
    audit("era.removed", title: @era.title)
    redirect_to fellow_timeline_path(@fellow), notice: "Removed #{@era.title}."
  end

  private

  def set_era = @era = @fellow.eras.find(params[:id])
  def era_params = params.require(:era).permit(:title, :start_year, :end_year, :summary, :tone)
end
