require "test_helper"

class JournalAndMatchingTest < ActionDispatch::IntegrationTest
  include Devise::Test::IntegrationHelpers
  include ActionMailer::TestHelper

  setup do
    build_world
    @other_historian = User.create!(name: "Other Historian", email: "h2@test", password: "pw-123456", role: "historian")
    [ @historian, @other_historian ].each { |h| HistorianProfile.create!(user: h, headline: "Historian", bio: "Bio") }
  end

  def api_headers
    post "/api/v1/session", params: { email: "f@test", password: "pw-123456", client: "test" }, as: :json
    { "Authorization" => "Bearer #{response.parsed_body['token']}" }
  end

  # ---------------------------------------------------------------- journal

  test "a private entry is seen only by the Fellow; a shared one also by their historian and admins" do
    secret = @fellow.journal_entries.create!(body: "just for me", written_on: Date.current)
    shared = @fellow.journal_entries.create!(body: "for my historian", written_on: Date.current, shared_with_historian: true)

    assert_equal [ secret, shared ].sort, JournalEntry.readable_by(@fellow_user, @fellow).sort
    assert_equal [ shared ], JournalEntry.readable_by(@historian, @fellow).to_a # interview host
    assert_equal [ shared ], JournalEntry.readable_by(@admin, @fellow).to_a
    assert_empty JournalEntry.readable_by(@other_historian, @fellow)

    sign_in @historian
    get fellow_journal_entries_path(@fellow)
    assert_response :success
    assert_includes response.body, "for my historian"
    refute_includes response.body, "just for me"
  end

  test "only the Fellow can write, change or delete entries" do
    entry = @fellow.journal_entries.create!(body: "mine", written_on: Date.current, shared_with_historian: true)
    sign_in @admin
    patch fellow_journal_entry_path(@fellow, entry), params: { journal_entry: { body: "changed" } }
    assert_response :forbidden
    delete fellow_journal_entry_path(@fellow, entry)
    assert_response :forbidden
    assert_equal "mine", entry.reload.body

    sign_in @fellow_user
    post fellow_journal_entries_path(@fellow), params: { journal_entry: { body: "A new memory", written_on: Date.current } }
    assert_redirected_to fellow_journal_entries_path(@fellow)
    assert_equal "A new memory", @fellow.journal_entries.order(:id).last.body
  end

  test "an entry needs words or a voice recording" do
    entry = @fellow.journal_entries.build(written_on: Date.current, body: " ")
    refute entry.valid?
  end

  test "a historian's question appears for the Fellow and disappears once answered" do
    sign_in @historian
    post fellow_journal_prompts_path(@fellow), params: { journal_prompt: { text: "Your first job?" } }
    prompt = @fellow.journal_prompts.last
    assert_equal "Your first job?", prompt.text

    headers = api_headers
    get "/api/v1/journal", headers: headers
    assert_equal [ prompt.id ], response.parsed_body["prompts"].map { |p| p["id"] }

    post "/api/v1/journal", params: { entry: { body: "The bakery", journal_prompt_id: prompt.id } }, headers:, as: :json
    assert_response :created
    get "/api/v1/journal", headers: headers
    assert_empty response.parsed_body["prompts"]
  end

  test "the desktop app saves a voice note and only the Fellow can fetch it" do
    headers = api_headers
    audio = Base64.strict_encode64("\x1A\x45\xDF\xA3fake-webm".b)
    post "/api/v1/journal", params: { entry: { shared_with_historian: false, voice: { base64: audio, content_type: "audio/webm;codecs=opus" } } }, headers:, as: :json
    assert_response :created
    id = response.parsed_body["id"]
    assert_equal "audio/webm", response.parsed_body.dig("voice", "content_type")
    get "/api/v1/journal/#{id}/voice", headers: headers
    assert_response :success
    assert_equal "\x1A\x45\xDF\xA3fake-webm".b, response.body.b

    sign_in @historian # private entry: the historian gets nothing
    get voice_fellow_journal_entry_path(@fellow, id)
    assert_response :not_found
  end

  test "an era from someone else's life is refused" do
    other_user = User.create!(name: "Other", email: "o@test", password: "pw-123456", role: "fellow")
    other = Fellow.create!(user: other_user)
    era = other.eras.create!(title: "Elsewhere", start_year: 1950)
    entry = @fellow.journal_entries.build(body: "x", written_on: Date.current, era:)
    refute entry.valid?
  end

  # ---------------------------------------------------------------- matching

  test "a match needs both sides, then an admin's confirmation" do
    @fellow.update!(match_intro: "I ran a bakery.", seeking_historian: true)

    sign_in @fellow_user
    post match_choose_path(historian_id: @other_historian.id)
    interest = MatchInterest.find_by!(fellow: @fellow, historian: @other_historian)
    assert interest.fellow_wants
    refute interest.mutual?

    sign_in @other_historian
    get match_path
    assert_includes response.body, "I ran a bakery."
    refute_includes response.body, @fellow_user.email # no contact details before a match
    assert_enqueued_emails(1) { post match_choose_path(fellow_id: @fellow.id) } # one admin
    assert interest.reload.mutual?
    assert_nil @fellow.reload.historian # not yet: an admin confirms

    sign_in @admin
    post confirm_match_path(interest)
    assert_equal @other_historian, @fellow.reload.historian
    refute @fellow.seeking_historian
    assert_equal "confirmed", interest.reload.status
    assert @other_historian.can_see?(@fellow)
  end

  test "a Fellow can choose at most three historians" do
    more = 3.times.map { |i| User.create!(name: "H#{i}", email: "hx#{i}@test", password: "pw-123456", role: "historian").tap { |h| HistorianProfile.create!(user: h) } }
    sign_in @fellow_user
    [ @historian, @other_historian, more[0] ].each { |h| post match_choose_path(historian_id: h.id) }
    post match_choose_path(historian_id: more[1].id)
    assert_equal 3, @fellow.match_interests.where(fellow_wants: true).count
    assert_match(/up to 3/, flash[:alert])
  end

  test "historians see only Fellows who are looking, and only a short card" do
    sign_in @other_historian
    get match_path
    refute_includes response.body, "I'd like to be Fellow's historian"
    @fellow.update!(seeking_historian: true)
    get match_path
    assert_includes response.body, "I'd like to be Fellow's historian"
    get fellow_path(@fellow)
    assert_response :not_found # the full profile stays closed until a match
  end

  test "the desktop app lists historians and records the Fellow's choice" do
    headers = api_headers
    get "/api/v1/historians", headers: headers
    names = response.parsed_body["historians"].map { |h| h["name"] }
    assert_includes names, "Other Historian"
    post "/api/v1/historians/#{@other_historian.id}/choose", headers:, as: :json
    assert response.parsed_body["chosen"]
    assert @fellow.reload.seeking_historian
    delete "/api/v1/historians/#{@other_historian.id}/choose", headers:, as: :json
    refute response.parsed_body["chosen"]
  end
end
