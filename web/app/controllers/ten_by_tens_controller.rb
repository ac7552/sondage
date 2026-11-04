class TenByTensController < ApplicationController
  before_action :set_fellow
  before_action :require_fellow_editor, except: :show

  def show
    @fellow.ensure_ten_by_ten_lists!
    @lists = @fellow.ten_by_ten_lists.includes(:entries)
    @active = @lists.find { |l| l.category == params[:list] } || @lists.first
  end

  def update
    list = @fellow.ten_by_ten_lists.find(params.require(:list_id))
    rows = params.fetch(:entries, {}).to_unsafe_h
    ActiveRecord::Base.transaction do
      (1..10).each do |rank|
        row = rows[rank.to_s] || {}
        entry = list.entries.find_or_initialize_by(rank:)
        if row["title"].blank? && row["note"].blank?
          entry.destroy if entry.persisted?
        else
          entry.update!(title: row["title"], note: row["note"], year: row["year"].presence&.to_i)
        end
      end
    end
    audit("ten_by_ten.saved", subject: list, category: list.category)
    redirect_to fellow_ten_by_ten_path(@fellow, list: list.category), notice: "#{list.title} saved."
  end

  # Memorable events with a year become timeline events; then a version is saved.
  def complete
    added = 0
    ActiveRecord::Base.transaction do
      list = @fellow.ten_by_ten_lists.find_by(category: "events")
      list&.entries&.each do |e|
        next if e.title.blank? || e.year.blank? || e.event_id
        ev = @fellow.events.create!(title: e.title, year: e.year, story: e.note, stage_added: "ten_by_ten", added_by: current_user)
        e.update!(event: ev)
        added += 1
      end
    end
    version = TimelineVersion.capture!(@fellow, stage: "after_ten_by_ten", author: current_user)
    @fellow.update!(stage: "refining") if @fellow.stage.in?(%w[intake ten_by_ten])
    audit("ten_by_ten.completed", subject: version, events_added: added)
    redirect_to fellow_timeline_path(@fellow), notice: "10x10 complete. #{added} memorable #{'event'.pluralize(added)} added to the timeline, and a new version saved."
  end
end
