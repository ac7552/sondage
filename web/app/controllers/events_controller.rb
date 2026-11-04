class EventsController < ApplicationController
  before_action :set_fellow
  before_action :require_fellow_editor
  before_action :set_event, only: %i[edit update destroy]

  def new = @event = @fellow.events.build

  def create
    @event = @fellow.events.build(event_params.merge(added_by: current_user, stage_added: stage_for_new_material))
    if @event.save
      audit("event.created", subject: @event)
      redirect_to back_path, notice: "Added “#{@event.title}”."
    else
      render :new, status: :unprocessable_entity
    end
  end

  def edit; end

  def update
    if @event.update(event_params)
      audit("event.updated", subject: @event)
      redirect_to fellow_timeline_path(@fellow), notice: "Updated “#{@event.title}”."
    else
      render :edit, status: :unprocessable_entity
    end
  end

  def destroy
    @event.destroy
    audit("event.removed", title: @event.title)
    redirect_to fellow_timeline_path(@fellow), notice: "Removed “#{@event.title}”."
  end

  private

  def set_event = @event = @fellow.events.find(params[:id])
  def event_params = params.require(:event).permit(:title, :year, :month, :date_text, :place_name, :story, :capsule_moment_seconds)
  def back_path = params[:return_to] == "intake" ? fellow_intake_path(@fellow, anchor: "key-dates") : fellow_timeline_path(@fellow)
end
