# The public receipt for a sealed capsule. The recording itself never comes here:
# it is encrypted to the Fellow's key and kept on storage the Fellow controls.
class Capsule < ApplicationRecord
  belongs_to :meeting
  belongs_to :fellow

  validates :capsule_uuid, :manifest_sha256, :capsule_sha256, :sealed_at, :receipt_json, presence: true
  validates :manifest_sha256, :capsule_sha256, format: { with: /\A[0-9a-f]{64}\z/ }

  def receipt = JSON.parse(receipt_json)
  def fingerprint = manifest_sha256.first(16).upcase.scan(/.{4}/).join(" ")
  def readonly? = persisted? # receipts are never edited

  def self.from_receipt!(meeting, receipt)
    create!(
      meeting:, fellow: meeting.fellow,
      capsule_uuid: receipt.fetch("capsuleId"),
      manifest_sha256: receipt.fetch("manifestSha256"),
      capsule_sha256: receipt.fetch("capsuleSha256"),
      capsule_bytes: receipt["capsuleBytes"],
      sealed_at: Time.iso8601(receipt.fetch("sealedAt")),
      timestamp_status: receipt.dig("timestamp", "status"),
      timestamp_gen_time: (Time.iso8601(receipt.dig("timestamp", "genTime")) rescue nil),
      receipt_json: JSON.pretty_generate(receipt.except("tsrBase64"))
    )
  end
end
