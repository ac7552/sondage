require "test_helper"

class MeetingPartsTest < ActiveSupport::TestCase
  setup { build_world }

  test "interviews are numbered as parts, each its own meeting" do
    assert_equal 1, @interview.part
    two = Meeting.create!(fellow: @fellow, host: @historian, kind: "interview", title: "Part two")
    assert_equal 2, two.part
    assert_equal "Part 2", two.part_label
    ten = Meeting.create!(fellow: @fellow, host: @admin, kind: "ten_by_ten", title: "10x10")
    assert_nil ten.part
  end
end
