# A question the historian or an admin leaves for the Fellow to write about.
class JournalPrompt < ApplicationRecord
  belongs_to :fellow
  belongs_to :author, class_name: "User"
  has_many :journal_entries, dependent: :nullify

  validates :text, presence: true, length: { maximum: 500 }
  scope :waiting, -> { where(dismissed_at: nil).where.not(id: JournalEntry.select(:journal_prompt_id).where.not(journal_prompt_id: nil)) }

  def answered? = journal_entries.exists?
end
