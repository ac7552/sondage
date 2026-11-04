class Fellow < ApplicationRecord
  STAGES = %w[intake ten_by_ten refining interview delivered].freeze
  STAGE_LABELS = {
    "intake" => "Intake", "ten_by_ten" => "10x10 session", "refining" => "Refining the profile",
    "interview" => "Ready for interview", "delivered" => "Capsule delivered"
  }.freeze

  belongs_to :user
  belongs_to :admin, class_name: "User", optional: true
  belongs_to :historian, class_name: "User", optional: true # the matched historian
  has_many :intake_answers, dependent: :destroy
  has_many :eras, -> { order(:start_year) }, dependent: :destroy
  has_many :events, -> { order(:year, :month) }, dependent: :destroy
  has_many :items, dependent: :destroy
  has_many :ten_by_ten_lists, -> { order(:position) }, dependent: :destroy
  has_many :meetings, -> { order(:scheduled_at) }, dependent: :destroy
  has_many :capsules, dependent: :restrict_with_error
  has_many :timeline_versions, -> { order(:created_at) }, dependent: :restrict_with_error
  has_many :audit_events # append-only; a Fellow with history cannot be deleted
  has_many :safety_contacts, -> { order(:role, :id) }, dependent: :destroy
  has_many :recoveries, -> { order(created_at: :desc) }, dependent: :destroy
  has_many :journal_entries, dependent: :destroy
  has_many :journal_prompts, -> { order(:created_at) }, dependent: :destroy
  has_many :match_interests, dependent: :destroy
  has_many :inheritance_claims, -> { order(created_at: :desc) }, dependent: :destroy

  # Sondage's own safety copy. Useless alone; encrypted at rest.
  encrypts :sondage_share

  validates :stage, inclusion: { in: STAGES }
  validates :age_recipient, format: { with: /\Aage1[0-9a-z]{58}\z/ }, allow_nil: true
  delegate :name, :email, to: :user

  validates :match_intro, length: { maximum: 1500 }
  validate { errors.add(:historian, "must be a historian") if historian && !historian.historian? }

  # What a historian sees before a match: no intake answers, no contact details.
  def match_card
    {
      id:, first_name: display_name.split.first, birth_decade: birth_year && "#{birth_year / 10 * 10}s",
      birth_place:, languages: languages.to_s.split(",").map(&:strip).reject(&:blank?), intro: match_intro
    }
  end

  def deceased? = deceased_at.present?
  def heirs = safety_contacts.where(heir: true)

  def display_name = preferred_name.presence || user.name
  def stage_label = STAGE_LABELS.fetch(stage, stage.humanize)
  def stage_index = STAGES.index(stage)
  def interviews = meetings.where(kind: "interview")

  def era_for(year)
    return if year.nil?
    eras.find { |e| year >= e.start_year && (e.end_year.nil? || year <= e.end_year) }
  end

  def ensure_ten_by_ten_lists!
    TenByTenList::CATEGORIES.each_with_index do |(category, title, prompt), i|
      ten_by_ten_lists.find_or_create_by!(category:) { |l| l.title = title; l.prompt = prompt; l.position = i }
    end
  end
end
