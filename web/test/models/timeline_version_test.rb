require "test_helper"

class TimelineVersionTest < ActiveSupport::TestCase
  setup do
    build_world
    era = @fellow.eras.create!(title: "Childhood", start_year: 1940, end_year: 1955)
    @fellow.events.create!(title: "Born", year: 1940)
    @version = TimelineVersion.capture!(@fellow, stage: "after_intake", author: @admin)
    @era = era
  end

  test "a saved version is frozen and fingerprinted" do
    assert @version.readonly?
    assert_equal Digest::SHA256.hexdigest(@version.snapshot_json), @version.snapshot_sha256
    assert_raises(ActiveRecord::ReadOnlyRecord) { @version.update!(label: "changed") }
  end

  test "later changes never alter an earlier version" do
    @era.update!(title: "Growing up")
    @fellow.events.create!(title: "School", year: 1946)
    later = TimelineVersion.capture!(@fellow, stage: "revision", author: @admin)
    assert_equal "Childhood", @version.reload.snapshot["eras"].first["title"]
    assert_equal "Growing up", later.snapshot["eras"].first["title"]
    assert_equal 1, @version.snapshot["events"].size
    assert_equal 2, later.snapshot["events"].size
  end

  test "context items keep their source label in the snapshot" do
    @fellow.items.create!(kind: "song", source: "context", title: "A song", year: 1950, added_by: @admin)
    item = TimelineVersion.capture!(@fellow, stage: "revision", author: @admin).snapshot["items"].first
    assert_equal "context", item["source"]
    assert_equal "Admin", item["addedBy"]
    assert_equal @era.id, item["eraId"]
  end
end
