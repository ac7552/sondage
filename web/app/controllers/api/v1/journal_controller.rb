# The Fellow's journal, for the desktop app. Voice notes travel as base64 in JSON
# (they're short), and are only ever sent back to the Fellow who recorded them.
class Api::V1::JournalController < Api::V1::BaseController
  before_action :require_fellow!
  before_action :set_entry, only: %i[update destroy voice versions]

  def index
    render json: {
      entries: @fellow.journal_entries.newest_first.includes(:era, :journal_prompt, voice_attachment: :blob).map(&:as_api_json),
      prompts: @fellow.journal_prompts.waiting.includes(:author).map { |p| { id: p.id, text: p.text, from: p.author.name } },
      eras: @fellow.eras.map { |e| { id: e.id, title: e.title, start_year: e.start_year, end_year: e.end_year } },
      historian: @fellow.historian&.name
    }
  end

  def create
    entry = @fellow.journal_entries.build(entry_params.merge(written_on: entry_params[:written_on].presence || Date.current))
    attach_voice(entry)
    entry.save!
    render json: entry.as_api_json, status: :created
  end

  def update
    @entry.assign_attributes(entry_params)
    if params[:remove_voice]
      @entry.voice.purge
    else
      attach_voice(@entry)
    end
    @entry.save!
    render json: @entry.as_api_json
  end

  def destroy
    @entry.destroy!
    head :no_content
  end

  def voice
    return head(:not_found) unless @entry.voice.attached?
    response.headers["Cache-Control"] = "private, no-store"
    send_data @entry.voice.download, type: @entry.voice.content_type, disposition: "inline"
  end

  # Earlier wordings, newest first. Only the Fellow sees these.
  def versions
    render json: { versions: @entry.versions.map(&:as_api_json) }
  end

  def dismiss_prompt
    @fellow.journal_prompts.find(params[:prompt_id]).update!(dismissed_at: Time.current)
    head :no_content
  end

  private

  def set_entry
    @entry = @fellow.journal_entries.find(params[:id])
  end

  def entry_params
    params.fetch(:entry, {}).permit(:body, :written_on, :era_id, :journal_prompt_id, :shared_with_historian)
  end

  def attach_voice(entry)
    v = params.dig(:entry, :voice)
    return unless v.is_a?(ActionController::Parameters) && v[:base64].present?
    bytes = Base64.strict_decode64(v[:base64])
    raise ActionController::BadRequest, "Voice recording is too long" if bytes.bytesize > JournalEntry::MAX_VOICE
    ext = { "audio/webm" => "webm", "audio/ogg" => "ogg", "audio/mp4" => "m4a", "audio/wav" => "wav" }[v[:content_type].to_s.split(";").first] || "audio"
    entry.voice.attach(io: StringIO.new(bytes), filename: "journal-#{Time.current.strftime('%Y%m%d-%H%M%S')}.#{ext}", content_type: v[:content_type].to_s.split(";").first)
  rescue ArgumentError
    raise ActionController::BadRequest, "The voice recording didn't arrive in one piece"
  end
end
