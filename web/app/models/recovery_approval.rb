class RecoveryApproval < ApplicationRecord
  belongs_to :recovery
  belongs_to :safety_contact
  validates :encrypted_piece, presence: true, length: { maximum: 4000 }
  validates :safety_contact_id, uniqueness: { scope: :recovery_id }
end
