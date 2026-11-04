# A request, made from a new computer, to rebuild a Fellow's key from two safety copies.
# Each approving holder encrypts their piece to the new computer's one-time key, so
# the pieces only ever come together on that computer.
class Recovery < ApplicationRecord
  STATUSES = %w[pending complete cancelled blocked].freeze

  belongs_to :fellow
  belongs_to :released_by, class_name: "User", optional: true
  belongs_to :blocked_by, class_name: "SafetyContact", optional: true
  has_many :approvals, class_name: "RecoveryApproval", dependent: :destroy

  validates :status, inclusion: { in: STATUSES }
  validates :recipient, format: { with: /\Aage1[0-9a-z]{58}\z/ }

  scope :pending, -> { where(status: "pending") }

  def pending? = status == "pending"
  def sondage_released? = sondage_released_at.present?
  def sondage_releasable? = pending? && !sondage_released? && Time.current >= release_after && fellow.sondage_share.present?
  def pieces_available = approvals.size + (sondage_released? ? 1 : 0)
  def ready? = pieces_available >= 2

  def self.wait_hours = Rails.configuration.x.recovery_wait_hours.to_f
end
