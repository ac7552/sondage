require "test_helper"

class InterviewChannelTest < ActionCable::Channel::TestCase
  setup { build_world }

  test "only the Fellow and the historian can join" do
    stub_connection current_user: @admin
    subscribe interview_id: @interview.id
    assert subscription.rejected?
  end

  test "the server decides who is speaking" do
    stub_connection current_user: @historian
    subscribe interview_id: @interview.id
    assert subscription.confirmed?
    assert_broadcast_on(InterviewChannel.broadcasting_for(@interview), { "type" => "offer", "sdp" => { "x" => 1 }, "from" => "historian" }) do
      perform :signal, payload: { type: "offer", sdp: { x: 1 }, from: "fellow" }
    end
  end

  test "a sealed interview can't be joined again" do
    @interview.update!(status: "sealed")
    stub_connection current_user: @fellow_user
    subscribe interview_id: @interview.id
    assert subscription.rejected?
  end
end
