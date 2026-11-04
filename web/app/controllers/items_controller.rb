class ItemsController < ApplicationController
  before_action :set_fellow
  before_action :require_fellow_editor
  before_action :set_item, only: %i[edit update destroy]

  def new
    @item = @fellow.items.build(kind: params[:kind].presence_in(Item::KINDS) || "photo", source: "own", event_id: params[:event_id])
  end

  def create
    @item = @fellow.items.build(item_params.merge(added_by: current_user, stage_added: stage_for_new_material))
    if @item.save
      audit("item.created", subject: @item, kind: @item.kind, source: @item.source)
      redirect_to fellow_timeline_path(@fellow), notice: "Added “#{@item.title}”."
    else
      render :new, status: :unprocessable_entity
    end
  end

  def edit; end

  def update
    if @item.update(item_params)
      audit("item.updated", subject: @item)
      redirect_to fellow_timeline_path(@fellow), notice: "Updated “#{@item.title}”."
    else
      render :edit, status: :unprocessable_entity
    end
  end

  def destroy
    @item.destroy
    audit("item.removed", title: @item.title, kind: @item.kind)
    redirect_to fellow_timeline_path(@fellow), notice: "Removed “#{@item.title}”."
  end

  private

  def set_item = @item = @fellow.items.find(params[:id])

  def item_params
    params.require(:item).permit(:kind, :source, :title, :caption, :year, :date_text, :creator, :publication, :url, :archive_url, :isrc, :place_name, :latitude, :longitude, :event_id, :file)
  end
end
