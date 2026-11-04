# Someone holding one safety copy of a Fellow's key: the Fellow or a family member.
# Sondage never sees their piece, only its SHA-256 fingerprint.
class SafetyContact < ApplicationRecord
  ROLES = %w[self family].freeze

  belongs_to :fellow
  has_many :recovery_approvals, dependent: :destroy
  has_many :blocked_recoveries, class_name: "Recovery", foreign_key: :blocked_by_id, dependent: :nullify

  normalizes :email, with: ->(e) { e.strip.downcase }
  validates :name, :email, presence: true
  validates :role, inclusion: { in: ROLES }
  validates :piece_sha256, format: { with: /\A[0-9a-f]{64}\z/ }, uniqueness: true

  def first_name = name.split.first
end
