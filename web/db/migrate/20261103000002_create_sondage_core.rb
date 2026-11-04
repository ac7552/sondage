class CreateSondageCore < ActiveRecord::Migration[8.0]
  def change
    create_table :users do |t|
      t.string :name, null: false
      t.string :email_address, null: false
      t.string :password_digest, null: false
      t.string :role, null: false, default: "fellow" # fellow | admin | historian
      t.string :signing_public_key   # Ed25519, raw 32 bytes, base64
      t.datetime :signing_key_registered_at
      t.timestamps
      t.index :email_address, unique: true
    end

    # Browser sign-ins (cookie)
    create_table :sessions do |t|
      t.references :user, null: false, foreign_key: true
      t.string :ip_address
      t.string :user_agent
      t.timestamps
    end

    # Desktop app sign-ins (bearer token). Only a digest of the token is stored.
    create_table :api_tokens do |t|
      t.references :user, null: false, foreign_key: true
      t.string :token_digest, null: false
      t.string :client
      t.datetime :last_used_at
      t.timestamps
      t.index :token_digest, unique: true
    end

    create_table :fellows do |t|
      t.references :user, null: false, foreign_key: true, index: { unique: true }
      t.references :admin, foreign_key: { to_table: :users }
      t.string :preferred_name
      t.integer :birth_year
      t.string :birth_place
      t.string :stage, null: false, default: "intake" # intake | ten_by_ten | refining | interview | delivered
      t.string :age_recipient # the age public key capsules are encrypted to
      t.timestamps
    end

    create_table :intake_questions do |t|
      t.string :section, null: false, default: "About you"
      t.string :prompt, null: false
      t.text :help
      t.string :kind, null: false, default: "short_text" # short_text | long_text | year | date | select | multi_select
      t.text :options # one per line, for select kinds
      t.boolean :required, null: false, default: false
      t.integer :position, null: false, default: 0
      t.timestamps
    end

    create_table :intake_answers do |t|
      t.references :fellow, null: false, foreign_key: true
      t.references :intake_question, null: false, foreign_key: true
      t.text :value
      t.references :answered_by, foreign_key: { to_table: :users }
      t.timestamps
      t.index [ :fellow_id, :intake_question_id ], unique: true
    end

    create_table :eras do |t|
      t.references :fellow, null: false, foreign_key: true
      t.string :title, null: false
      t.integer :start_year, null: false
      t.integer :end_year
      t.text :summary
      t.string :tone, null: false, default: "ochre" # a muted accent for this stretch of the curve
      t.timestamps
    end

    create_table :events do |t|
      t.references :fellow, null: false, foreign_key: true
      t.string :title, null: false
      t.integer :year, null: false
      t.integer :month
      t.string :date_text  # how the Fellow says it: "spring 1962", "the early seventies"
      t.string :place_name
      t.text :story        # in the Fellow's own words
      t.string :stage_added, null: false, default: "intake"
      t.references :added_by, foreign_key: { to_table: :users }
      t.integer :capsule_moment_seconds # where it comes up in the sealed interview
      t.timestamps
    end

    # Photos, articles, songs, letters, documents and places
    create_table :items do |t|
      t.references :fellow, null: false, foreign_key: true
      t.references :event, foreign_key: true
      t.string :kind, null: false, default: "photo" # photo | article | song | letter | document | place
      t.string :source, null: false, default: "own" # own (from the Fellow's life) | context (added to set the scene)
      t.string :title, null: false
      t.text :caption
      t.integer :year
      t.string :date_text
      t.string :creator      # artist, author, photographer
      t.string :publication  # newspaper, album, archive
      t.string :url
      t.string :archive_url  # e.g. a Wayback Machine snapshot
      t.string :isrc         # recording code, for songs
      t.string :place_name
      t.decimal :latitude, precision: 9, scale: 6
      t.decimal :longitude, precision: 9, scale: 6
      t.string :stage_added, null: false, default: "intake"
      t.references :added_by, foreign_key: { to_table: :users }
      t.timestamps
    end

    create_table :ten_by_ten_lists do |t|
      t.references :fellow, null: false, foreign_key: true
      t.string :category, null: false
      t.string :title, null: false
      t.text :prompt
      t.integer :position, null: false, default: 0
      t.timestamps
      t.index [ :fellow_id, :category ], unique: true
    end

    create_table :ten_by_ten_entries do |t|
      t.references :ten_by_ten_list, null: false, foreign_key: true
      t.integer :rank, null: false
      t.string :title
      t.text :note
      t.integer :year
      t.references :event, foreign_key: true
      t.references :item, foreign_key: true
      t.timestamps
      t.index [ :ten_by_ten_list_id, :rank ], unique: true
    end

    create_table :meetings do |t|
      t.references :fellow, null: false, foreign_key: true
      t.references :host, null: false, foreign_key: { to_table: :users } # the admin (10x10) or historian (interview)
      t.string :kind, null: false, default: "interview" # ten_by_ten | interview
      t.string :media_type, null: false, default: "audio" # audio | video
      t.string :title, null: false
      t.datetime :scheduled_at
      t.string :status, null: false, default: "scheduled" # scheduled | in_progress | sealed | completed
      t.text :historian_notes # the historian's own questions, written by hand
      t.timestamps
    end

    # Proof that a capsule exists. Never the recording itself.
    create_table :capsules do |t|
      t.references :meeting, null: false, foreign_key: true, index: { unique: true }
      t.references :fellow, null: false, foreign_key: true
      t.string :capsule_uuid, null: false
      t.string :manifest_sha256, null: false
      t.string :capsule_sha256, null: false
      t.bigint :capsule_bytes
      t.datetime :sealed_at, null: false
      t.string :timestamp_status
      t.datetime :timestamp_gen_time
      t.text :receipt_json, null: false
      t.timestamps
      t.index :capsule_uuid, unique: true
    end

    create_table :timeline_versions do |t|
      t.references :fellow, null: false, foreign_key: true
      t.string :stage, null: false # after_intake | after_ten_by_ten | after_interview | revision
      t.string :label, null: false
      t.text :snapshot_json, null: false
      t.string :snapshot_sha256, null: false
      t.string :capsule_manifest_sha256 # set on versions made after the interview
      t.references :author, null: false, foreign_key: { to_table: :users }
      t.datetime :created_at, null: false
    end

    # Append-only chain-of-custody log
    create_table :audit_events do |t|
      t.references :fellow, foreign_key: true
      t.references :actor, foreign_key: { to_table: :users }
      t.string :action, null: false
      t.string :subject_type
      t.bigint :subject_id
      t.text :data_json
      t.datetime :created_at, null: false
    end
  end
end
