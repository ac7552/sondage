# The Fellow's journal on the web. The Fellow reads and writes everything here;
# their historian and admins see only entries the Fellow chose to share, and can
# leave questions for the Fellow to write about.
class JournalEntriesController < ApplicationController
  before_action :set_fellow
  before_action :set_entry, only: %i[edit update destroy]
  before_action :require_owner, only: %i[create edit update destroy]

  def index
    @owner = owner?
    @entries = JournalEntry.readable_by(current_user, @fellow).newest_first.includes(:era, :journal_prompt, :versions, voice_attachment: :blob)
    @prompts = @owner ? @fellow.journal_prompts.waiting.includes(:author) : @fellow.journal_prompts.includes(:author, :journal_entries)
    @entry = @fellow.journal_entries.build(written_on: Date.current, journal_prompt_id: params[:prompt]) if @owner
  end

  def create
    @entry = @fellow.journal_entries.build(entry_params)
    if @entry.save
      redirect_to fellow_journal_entries_path(@fellow), notice: "Saved in your journal."
    else
      @owner = true
      @entries = @fellow.journal_entries.newest_first
      @prompts = @fellow.journal_prompts.waiting
      render :index, status: :unprocessable_entity
    end
  end

  def edit; end

  # Voice recordings are sent only to people who may read the entry (never a public link).
  def voice
    entry = JournalEntry.readable_by(current_user, @fellow).find(params[:id])
    return head(:not_found) unless entry.voice.attached?
    response.headers["Cache-Control"] = "private, no-store"
    send_data entry.voice.download, type: entry.voice.content_type, disposition: "inline"
  end

  def update
    @entry.voice.purge if params[:remove_voice] == "1"
    if @entry.update(entry_params)
      redirect_to fellow_journal_entries_path(@fellow), notice: "Saved."
    else
      render :edit, status: :unprocessable_entity
    end
  end

  def destroy
    @entry.destroy!
    redirect_to fellow_journal_entries_path(@fellow), notice: "Deleted from your journal."
  end

  private

  def owner? = @fellow.user_id == current_user.id

  def require_owner
    head :forbidden unless owner?
  end

  def set_entry
    @entry = @fellow.journal_entries.find(params[:id])
  end

  def entry_params
    params.require(:journal_entry).permit(:body, :written_on, :era_id, :journal_prompt_id, :shared_with_historian, :voice)
  end
end
