class JournalEntryVersion < ApplicationRecord
  belongs_to :journal_entry
  def as_api_json = { id:, body:, written_until: written_until.iso8601 }
end
