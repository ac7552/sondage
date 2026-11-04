class User < ApplicationRecord
  ROLES = %w[fellow admin historian heir].freeze # heir: family member receiving recordings after a Fellow's death

  devise :database_authenticatable, :recoverable, :rememberable, :validatable, :lockable
  has_many :api_tokens, dependent: :destroy
  has_one :fellow, dependent: :destroy
  has_many :hosted_meetings, class_name: "Meeting", foreign_key: :host_id, dependent: :restrict_with_error
  has_one :historian_profile, dependent: :destroy
  has_many :matched_fellows, class_name: "Fellow", foreign_key: :historian_id, dependent: :nullify
  has_many :match_interests, foreign_key: :historian_id, dependent: :destroy
  has_many :inheritance_claims, foreign_key: :heir_user_id, dependent: :nullify

  validates :name, presence: true
  validates :role, inclusion: { in: ROLES }
  validates :signing_public_key, format: { with: /\A[A-Za-z0-9+\/]{43}=\z/, message: "must be a base64 Ed25519 public key" }, allow_nil: true

  ROLES.each { |r| define_method(:"#{r}?") { role == r } }

  def first_name = name.split.first

  # Fellows the person may see: admins see everyone; historians see the people they
  # are matched with or interview. (Before a match, historians see only a short card.)
  def visible_fellows
    case role
    when "admin" then Fellow.all
    when "historian" then Fellow.where(id: hosted_meetings.select(:fellow_id)).or(Fellow.where(historian_id: id))
    when "heir" then Fellow.none
    else Fellow.where(user_id: id)
    end
  end

  def can_see?(fellow) = visible_fellows.exists?(fellow.id)
end
