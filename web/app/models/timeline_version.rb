# A frozen snapshot of the timeline at one stage. Never edited: refining the
# timeline makes a new version, so the story's growth can always be seen.
class TimelineVersion < ApplicationRecord
  STAGES = {
    "after_intake" => "After intake",
    "after_ten_by_ten" => "After the 10x10 session",
    "after_interview" => "After the interview",
    "revision" => "Revision"
  }.freeze

  belongs_to :fellow
  belongs_to :author, class_name: "User"
  validates :stage, inclusion: { in: STAGES.keys }
  validates :label, :snapshot_json, :snapshot_sha256, presence: true

  def readonly? = persisted?
  def snapshot = JSON.parse(snapshot_json)
  def fingerprint = snapshot_sha256.first(16).upcase.scan(/.{4}/).join(" ")

  def self.capture!(fellow, stage:, author:, label: nil)
    data = TimelineSnapshot.new(fellow).to_h
    json = JSON.pretty_generate(data)
    create!(
      fellow:, stage:, author:,
      label: label.presence || "#{STAGES.fetch(stage)} · #{Time.current.strftime('%B %-d, %Y')}",
      snapshot_json: json,
      snapshot_sha256: Digest::SHA256.hexdigest(json),
      capsule_manifest_sha256: (fellow.capsules.order(:sealed_at).last&.manifest_sha256 if stage.in?(%w[after_interview revision]))
    )
  end
end
