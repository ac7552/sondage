# Relays call introductions between the Fellow and the historian: the offer,
# the answer and network candidates. The call itself, and every recorded
# chunk, travels directly between their devices and never through here.
class InterviewChannel < ApplicationCable::Channel
  ALLOWED = %w[ping ready offer answer ice bye].freeze

  def subscribed
    @meeting = Meeting.interviews.find_by(id: params[:interview_id])
    return reject unless @meeting&.participant?(current_user) && !@meeting.sealed?
    stream_for @meeting
  end

  def signal(data)
    payload = data["payload"].to_h.deep_stringify_keys.slice("type", "sdp", "candidate")
    return unless payload["type"].in?(ALLOWED)
    # The server decides who is speaking; a client can't pretend to be the other side.
    payload["from"] = current_user.id == @meeting.host_id ? "historian" : "fellow"
    @meeting.update_column(:status, "in_progress") if payload["type"] == "offer" && @meeting.status == "scheduled"
    InterviewChannel.broadcast_to(@meeting, payload)
  end
end
