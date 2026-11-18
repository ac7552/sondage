# Switches for everything beyond the first version of Sondage Resounder: connect,
# hold a Sitting, deliver the recording to the Senior Fellow. Each feature is off
# unless named in SONDAGE_FEATURES (comma-separated, or "all"). Tests run with
# everything on, and switch features off where they test the first version.
module Feature
  ALL = {
    "intake" => "Intake questions",
    "ten_by_ten" => "10x10 lists",
    "stages" => "The Fellow's stages (intake to delivered)",
    "timeline" => "The life timeline",
    "journal" => "The journal and historians' questions",
    "matching" => "Choosing a historian",
    "safety_copies" => "Encryption keys, safety copies and recovery",
    "heirs" => "Opening recordings after a Fellow's death",
    "sealed_capsules" => "Encrypted, co-signed capsules and receipts",
    "recordings_vault" => "My recordings, listening and certificates in the app",
    "device_check" => "The headphone and microphone steps before a Sitting",
    "room_checklist" => "The Scholar's room checklist and test clip",
    "record_video" => "Recording video (otherwise video is live only)"
  }.freeze

  def self.enabled?(name) = enabled.include?(name.to_s)
  def self.enabled = Thread.current[:sondage_features] || configured
  def self.configured = @configured ||= parse(ENV.fetch("SONDAGE_FEATURES") { Rails.env.test? ? "all" : "" })

  def self.parse(value)
    names = value.to_s.split(",").map(&:strip).reject(&:empty?)
    names.include?("all") ? ALL.keys : names & ALL.keys
  end

  # For tests: run a block with exactly these features on.
  def self.with(*names)
    before = Thread.current[:sondage_features]
    Thread.current[:sondage_features] = names.flatten.map(&:to_s)
    yield
  ensure
    Thread.current[:sondage_features] = before
  end
end
