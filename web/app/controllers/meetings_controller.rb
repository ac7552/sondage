class MeetingsController < ApplicationController
  before_action :set_fellow, only: %i[new create]
  before_action :require_admin, only: %i[new create]
  before_action :set_meeting, only: %i[show update room]

  def new
    kind = params[:kind].presence_in(Meeting::KINDS.keys) || "interview"
    @meeting = @fellow.meetings.build(kind:, media_type: "audio", title: default_title(kind), scheduled_at: 1.week.from_now.change(hour: 10))
  end

  def create
    @meeting = @fellow.meetings.build(params.require(:meeting).permit(:kind, :host_id, :media_type, :title, :scheduled_at))
    if @meeting.save
      audit("meeting.scheduled", subject: @meeting, kind: @meeting.kind, host: @meeting.host.name)
      redirect_to fellow_path(@fellow), notice: "#{@meeting.title} scheduled."
    else
      render :new, status: :unprocessable_entity
    end
  end

  def show; end

  # The historian writes their own questions here, by hand.
  def update
    return head(:forbidden) unless current_user.id == @meeting.host_id || current_user.admin?
    allowed = %i[historian_notes scheduled_at]
    allowed << :media_type if current_user.admin? && !@meeting.sealed?
    @meeting.update!(params.require(:meeting).permit(*allowed))
    redirect_to meeting_path(@meeting), notice: "Saved."
  end

  # The historian's side of the interview, in the browser.
  def room
    return head(:forbidden) unless @meeting.interview? && current_user.id == @meeting.host_id
    @fellow_data = TimelineSnapshot.new(@fellow).to_h
    render layout: "room"
  end

  private

  def set_meeting
    @meeting = Meeting.find(params[:id])
    @fellow = @meeting.fellow
    head :not_found unless current_user.admin? || @meeting.participant?(current_user)
  end

  def default_title(kind)
    kind == "interview" ? "Life history interview with #{@fellow.display_name}" : "10x10 session with #{@fellow.display_name}"
  end
end
