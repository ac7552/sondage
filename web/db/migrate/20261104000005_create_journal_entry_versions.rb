# Earlier wordings of a journal entry. Each time the Fellow changes an entry, the
# words as they were are kept here, so nothing they wrote is ever lost.
class CreateJournalEntryVersions < ActiveRecord::Migration[8.0]
  def change
    create_table :journal_entry_versions do |t|
      t.references :journal_entry, null: false, foreign_key: { on_delete: :cascade }
      t.text :body
      t.datetime :written_until, null: false # when these words were replaced
      t.timestamps
    end
  end
end
